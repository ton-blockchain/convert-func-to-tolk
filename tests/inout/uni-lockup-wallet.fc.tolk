import "@stdlib/tvm-dicts"
import "@stdlib/tvm-lowlevel"
import "@stdlib/gas-payments"

// Restricted wallet initialized by a third party (a variant of restricted-wallet3-code.fc)
// Allows to add more locked budget after initialization

@pure
fun `err:wrong_signature`(): int
    asm "31 PUSHINT";
@pure
fun `err:wrong_config_signature`(): int
    asm "32 PUSHINT";
@pure
fun `err:value_is_too_small`(): int
    asm "33 PUSHINT";
@pure
fun `err:wrong_seqno`(): int
    asm "34 PUSHINT";
@pure
fun `err:wrong_subwallet_id`(): int
    asm "35 PUSHINT";
@pure
fun `err:replay_protection`(): int
    asm "36 PUSHINT";
@pure
fun `err:unknown_op`(): int
    asm "40 PUSHINT";
@pure
fun `err:unknown_cmd`(): int
    asm "41 PUSHINT";

@pure
fun `op:rwallet_op`(): int
    asm "0x82eaf9c4 PUSHINT";
@pure
fun `cmd:restricted_transfer`(): int
    asm "0x373aa9f4 PUSHINT";

fun isWhitelisted(addr: todo, allowedDestinations: todo) {
    var (_, _, _, found: int) = allowedDestinations.prefixDictGet(addr.remainingBitsCount(), addr);
    return found;
}

fun slice.loadUint32(mutate self): int {
    return self.loadUint(32);
}

@inline_ref
fun checkMessageDestination(msg: todo, allowedDestinations: todo) {
    var cs = msg.beginParse();
    var flags = cs.loadUint(4);
    if (flags & 8) {
        // external messages are always valid
        return true;
    }
    var (sAddr, dAddr) = (cs.loadAddress(), cs.loadAddress());

    return isWhitelisted(dAddr, allowedDestinations);
}

fun unpackData() {
    var cs = contract.getData().beginParse();
    var res = (
        cs.loadUint32(),
        cs.loadUint(32),
        cs.loadUint(256),
        cs.loadUint(256),
        cs.loadDict(),
        cs.loadCoins(),
        cs.loadDict(),
        cs.loadCoins(),
        cs.loadDict()
    );
    cs.assertEnd();
    return res;
}

fun packData(seqno: int, subwalletId: int, publicKey: int, configPublicKey: int, allowedDestinations: cell, totalLockedValue: int, locked: cell, totalRestrictedValue: int, restricted: cell) {
    return beginCell()
        .storeInt(seqno, 32)
        .storeInt(subwalletId, 32)
        .storeUint(publicKey, 256)
        .storeUint(configPublicKey, 256)
        .storeDict(allowedDestinations)
        .storeCoins(totalLockedValue)
        .storeDict(locked)
        .storeCoins(totalRestrictedValue)
        .storeDict(restricted).endCell();
}

fun lockGrams(locked: cell, total: int, ts: int, value: int): (cell, int) {
    total += value;
    var (foundCs: slice, found: todo) = locked.uDictGet(32, ts);
    if (found) {
        var foundValue = foundCs.loadCoins();
        foundCs.assertEnd();
        value += foundValue;
    }
    locked.uDictSetBuilder(32, ts, beginCell().storeCoins(value));
    locked.uDictDeleteFirstAndGet(32);
    return (locked, total);
}

fun unlockGrams(locked: cell, total: int, nowTs: int): (cell, int) {
    do {
        var (`locked'`, ts, valueCs, f) = locked.uDictDeleteFirstAndGet(32);
        f.stackMoveToTop();
        if (f) {
            f = ts <= nowTs;
        }
        if (f) {
            locked = `locked'`;
            var value: int = valueCs.loadCoins();
            valueCs.assertEnd();
            total -= value;
        }
    } while (!(~ f));
    return (locked, total);
}

// in the future, use: fun onInternalMessage(in: InMessage) {
fun onInternalMessage(msgValue: int, inMsgCell: cell, inMsg: slice) {
    var cs = inMsgCell.beginParse();
    var flags = cs.loadUint(4);  // int_msg_info$0 ihr_disabled:Bool bounce:Bool bounced:Bool
    if (flags & 1) {
        // ignore all bounced messages
        return;
    }
    var sAddr = cs.loadAddress();
    if (inMsg.isEmpty()) {
        return;
    }
    var op: int = inMsg.loadUint32();
    if (op <= 1) {
        // simple transfer with comment, return
        return;
    }
    var (storedSeqno, storedSubwallet, publicKey, configPublicKey, allowedDestinations, totalLockedValue, locked,
        totalRestrictedValue, restricted) = unpackData();

    if (isWhitelisted(sAddr, allowedDestinations) & (op != `op:rwallet_op`())) {
        return;
    }

    assert(op == `op:rwallet_op`()) throw `err:unknown_op`();
    assert(msgValue >= 1000000000) throw `err:value_is_too_small`();



    var signature = inMsg.loadBits(512);
    assert(isSignatureValid(inMsg.hash(), signature, configPublicKey)) throw `err:wrong_config_signature`();
    var cmd: int = inMsg.loadUint(32);
    assert(cmd == `cmd:restricted_transfer`()) throw `err:unknown_cmd`();
    var (onlyRestrict, ts) = (inMsg.loadUint(1), inMsg.loadUint32());
    if (onlyRestrict) {
        (restricted, totalRestrictedValue) = lockGrams(restricted, totalRestrictedValue, ts, msgValue);
    } else if(true /* false */) {
        (locked, totalLockedValue) = lockGrams(locked, totalLockedValue, ts, msgValue);
    }

    contract.setData(packData(storedSeqno, storedSubwallet, publicKey, configPublicKey, allowedDestinations, totalLockedValue, locked,
        totalRestrictedValue, restricted));
}

fun onExternalMessage(inMsg: slice) {
    var signature = inMsg.loadBits(512);
    var cs = inMsg;
    var (subwalletId, validUntil, msgSeqno) = (cs.loadUint(32), cs.loadUint32(), cs.loadUint(32));
    assert(!(validUntil <= blockchain.now())) throw `err:replay_protection`();
    var (storedSeqno, storedSubwallet, publicKey, configPublicKey, allowedDestinations, totalLockedValue, locked,
        totalRestrictedValue, restricted) = unpackData();
    assert(msgSeqno == storedSeqno) throw `err:wrong_seqno`();
    assert(subwalletId == storedSubwallet) throw `err:wrong_subwallet_id`();
    assert(isSignatureValid(inMsg.hash(), signature, publicKey)) throw `err:wrong_signature`();
    acceptExternalMessage();

    (restricted, totalRestrictedValue) = unlockGrams(restricted, totalRestrictedValue, blockchain.now());
    (locked, totalLockedValue) = unlockGrams(locked, totalLockedValue, blockchain.now());
    var effectivelyLocked: int = totalLockedValue;
    var canUseRestricted: int = 1;
    var csCopy = cs;
    while (csCopy.remainingRefsCount()) {
        var mode = csCopy.loadUint(8);
        var msg = csCopy.loadRef();
        canUseRestricted &= checkMessageDestination(msg, allowedDestinations);
    }

    if (!canUseRestricted) {
        effectivelyLocked += totalRestrictedValue;
    }
    reserveToncoinsOnBalance(effectivelyLocked, 2);

    cs.stackMoveToTop();
    while (cs.remainingRefsCount()) {
        var mode = cs.loadUint(8);
        var msg = cs.loadRef();
        sendRawMessage(msg, mode);
    }
    cs.assertEnd();

    contract.setData(packData(storedSeqno + 1, storedSubwallet, publicKey, configPublicKey, allowedDestinations, totalLockedValue, locked,
        totalRestrictedValue, restricted));
}

// Get methods

get fun seqno(): int {
    return contract.getData().beginParse().preloadUint(32);
}

get fun wallet_id(): int {
    var ds = contract.getData().beginParse();
    ds.loadUint32();
    return ds.preloadUint(32);
}

get fun get_public_key(): int {
    var ds = contract.getData().beginParse();
    ds.loadUint(32 + 32);
    return ds.preloadUint(256);
}

// the next three methods are mostly for testing

get fun get_balances_at(time: int): (int, int, int) {
    var (storedSeqno, storedSubwallet, publicKey, configPublicKey, allowedDestinations, totalLockedValue, locked,
        totalRestrictedValue, restricted) = unpackData();
    (restricted, totalRestrictedValue) = unlockGrams(restricted, totalRestrictedValue, time);
    (locked, totalLockedValue) = unlockGrams(locked, totalLockedValue, time);
    var tonBalance: int = contract.getOriginalBalance();
    try { } catch { }
    return ( tonBalance,
        totalRestrictedValue,
        totalLockedValue );
}

@method_id(123)
fun get_balances(): (int, int, int) {
    return get_balances_at(blockchain.now());
}

get fun check_destination(destination: slice): int {
    var (storedSeqno, storedSubwallet, publicKey, configPublicKey, allowedDestinations, totalLockedValue, locked,
        totalRestrictedValue, restricted) = unpackData();
    return isWhitelisted(destination, allowedDestinations);
}

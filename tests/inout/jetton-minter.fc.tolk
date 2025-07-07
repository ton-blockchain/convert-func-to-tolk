// Jetton minter smart contract

tolk 1.0

import "@stdlib/gas-payments"
import "@stdlib/tvm-dicts"
import "op-codes"
import "workchain"
import "jetton-utils"
import "gas"

// storage#_ total_supply:Coins admin_address:MsgAddress next_admin_address:MsgAddress jetton_wallet_code:^Cell metadata_uri:^Cell = Storage;
@inline
fun loadData(): (int, slice, slice, cell, cell) {
    var ds: slice = contract.getData().beginParse();
    var data = (
        ds.loadCoins(), // total_supply
        ds.loadAddress(), // admin_address
        ds.loadAddress(), // next_admin_address
        ds.loadRef(),  // jetton_wallet_code
        ds.loadRef()  // metadata url (contains snake slice without 0x0 prefix)
    );
    ds.assertEnd();
    return data;
}

@inline
fun saveData(totalSupply: int, adminAddress: address, nextAdminAddress: address, jettonWalletCode: cell, metadataUri: cell) {
    contract.setData(
        beginCell()
        .storeCoins(totalSupply)
        .storeAddress(adminAddress)
        .storeAddress(nextAdminAddress)
        .storeRef(jettonWalletCode)
        .storeRef(metadataUri)
        .endCell()
    );
}

@inline
fun sendToJettonWallet(toAddress: address, jettonWalletCode: cell, tonAmount: int, masterMsg: cell, needStateInit: int) {
    reserveToncoinsOnBalance(ONE_TON, RESERVE_REGULAR); // reserve for storage fees

    var stateInit: cell = calculateJettonWalletStateInit(toAddress, contract.getAddress(), jettonWalletCode);
    var toWalletAddress: address = calculateJettonWalletAddress(stateInit);

    // build MessageRelaxed, see TL-B layout in stdlib.fc#L733
    var msg = beginCell()
    .storeMsgFlagsAndAddressNone(BOUNCEABLE)
    .storeAddress(toWalletAddress) // dest
    .storeCoins(tonAmount);

    if (needStateInit) {
        msg = msg.storeStatinitRefAndBodyRef(stateInit, masterMsg);
    } else {
        msg = msg.storeOnlyBodyRef(masterMsg);
    }

    sendRawMessage(msg.endCell(), SEND_MODE_PAY_FEES_SEPARATELY | SEND_MODE_BOUNCE_ON_ACTION_FAIL);
}

// in the future, use: fun onInternalMessage(in: InMessage) {
fun onInternalMessage(msgValue: int, inMsgFull: cell, inMsgBody: slice) {
    var inMsgFullSlice: slice = inMsgFull.beginParse();
    var msgFlags: int = inMsgFullSlice.loadMsgFlags();

    if (msgFlags & 1) { // is bounced
        inMsgBody.skipBouncedPrefix();
        // process only mint bounces
        if (!(inMsgBody.loadOp() == OP_INTERNAL_TRANSFER)) {
            return;
        }
        inMsgBody.skipQueryId();
        var jettonAmount: int = inMsgBody.loadCoins();
        var (totalSupply: int, adminAddress: address, nextAdminAddress: address, jettonWalletCode: cell, metadataUri: cell) = loadData();
        saveData(totalSupply - jettonAmount, adminAddress, nextAdminAddress, jettonWalletCode, metadataUri);
        return;
    }
    var senderAddress: address = inMsgFullSlice.loadAddress();
    var fwdFeeFromInMsg: int = inMsgFullSlice.retrieveFwdFee();
    var fwdFee: int = calculateOriginalForwardFee(MY_WORKCHAIN, fwdFeeFromInMsg); // we use message fwd_fee for estimation of forward_payload costs

    var (op: int, queryId: int) = inMsgBody.loadOpAndQueryId();

    var (totalSupply: int, adminAddress: address, nextAdminAddress: address, jettonWalletCode: cell, metadataUri: cell) = loadData();

    if (op == OP_MINT) {
        assert(senderAddress.bitsEqual(adminAddress)) throw ERROR_NOT_OWNER;
        var toAddress: address = inMsgBody.loadAddress();
        checkSameWorkchain(toAddress);
        var tonAmount: int = inMsgBody.loadCoins();
        var masterMsg: cell = inMsgBody.loadRef();
        inMsgBody.assertEnd();

        // see internal_transfer TL-B layout in jetton.tlb
        var masterMsgSlice: slice = masterMsg.beginParse();
        assert(masterMsgSlice.loadOp() == OP_INTERNAL_TRANSFER) throw ERROR_INVALID_OP;
        masterMsgSlice.skipQueryId();
        var jettonAmount: int = masterMsgSlice.loadCoins();
        masterMsgSlice.loadAddress(); // from_address
        masterMsgSlice.loadAddress(); // response_address
        var forwardTonAmount: int = masterMsgSlice.loadCoins(); // forward_ton_amount
        checkEitherForwardPayload(masterMsgSlice); // either_forward_payload

        // a little more than needed, it’s ok since it’s sent by the admin and excesses will return back
        checkAmountIsEnoughToTransfer(tonAmount, forwardTonAmount, fwdFee);

        sendToJettonWallet(toAddress, jettonWalletCode, tonAmount, masterMsg, TRUE);
        saveData(totalSupply + jettonAmount, adminAddress, nextAdminAddress, jettonWalletCode, metadataUri);
        return;
    }

    if (op == OP_BURN_NOTIFICATION) {
        // see burn_notification TL-B layout in jetton.tlb
        var jettonAmount: int = inMsgBody.loadCoins();
        var fromAddress: address = inMsgBody.loadAddress();
        assert(calculateUserJettonWalletAddress(fromAddress, contract.getAddress(), jettonWalletCode).bitsEqual(senderAddress)) throw ERROR_NOT_VALID_WALLET;
        saveData(totalSupply - jettonAmount, adminAddress, nextAdminAddress, jettonWalletCode, metadataUri);
        var responseAddress: address = inMsgBody.loadAddress();
        inMsgBody.assertEnd();

        if (~ responseAddress.isNone()) {
            // build MessageRelaxed, see TL-B layout in stdlib.fc#L733
            var msg = beginCell()
            .storeMsgFlagsAndAddressNone(NON_BOUNCEABLE)
            .storeAddress(responseAddress) // dest
            .storeCoins(0)
            .storePrefixOnlyBody()
            .storeOp(OP_EXCESSES)
            .storeQueryId(queryId);
            sendRawMessage(msg.endCell(), SEND_MODE_IGNORE_ERRORS | SEND_MODE_CARRY_ALL_REMAINING_MESSAGE_VALUE);
        }
        return;
    }

    if (op == OP_PROVIDE_WALLET_ADDRESS) {
        // see provide_wallet_address TL-B layout in jetton.tlb
        var ownerAddress: address = inMsgBody.loadAddress();
        var isIncludeAddress: int = inMsgBody.loadBool();
        inMsgBody.assertEnd();

        var includedAddress: cell = isIncludeAddress
        ? beginCell().storeAddress(ownerAddress).endCell()
        : null;

        // build MessageRelaxed, see TL-B layout in stdlib.fc#L733
        var msg = beginCell()
        .storeMsgFlagsAndAddressNone(NON_BOUNCEABLE)
        .storeAddress(senderAddress)
        .storeCoins(0)
        .storePrefixOnlyBody()
        .storeOp(OP_TAKE_WALLET_ADDRESS)
        .storeQueryId(queryId);

        if (isSameWorkchain(ownerAddress)) {
            msg = msg.storeAddress(calculateUserJettonWalletAddress(ownerAddress, contract.getAddress(), jettonWalletCode));
        } else {
            msg = msg.storeAddressNone();
        }

        var msgCell: cell = msg.storeMaybeRef(includedAddress).endCell();

        sendRawMessage(msgCell, SEND_MODE_CARRY_ALL_REMAINING_MESSAGE_VALUE | SEND_MODE_BOUNCE_ON_ACTION_FAIL);
        return;
    }

    if (op == OP_CHANGE_ADMIN) {
        assert(senderAddress.bitsEqual(adminAddress)) throw ERROR_NOT_OWNER;
        nextAdminAddress = inMsgBody.loadAddress();
        inMsgBody.assertEnd();
        saveData(totalSupply, adminAddress, nextAdminAddress, jettonWalletCode, metadataUri);
        return;
    }

    if (op == OP_CLAIM_ADMIN) {
        inMsgBody.assertEnd();
        assert(senderAddress.bitsEqual(nextAdminAddress)) throw ERROR_NOT_OWNER;
        saveData(totalSupply, nextAdminAddress, createAddressNone(), jettonWalletCode, metadataUri);
        return;
    }

    // can be used to lock, unlock or reedem funds
    if (op == OP_CALL_TO) {
        assert(senderAddress.bitsEqual(adminAddress)) throw ERROR_NOT_OWNER;
        var toAddress: address = inMsgBody.loadAddress();
        var tonAmount: int = inMsgBody.loadCoins();
        var masterMsg: cell = inMsgBody.loadRef();
        inMsgBody.assertEnd();

        var masterMsgSlice: slice = masterMsg.beginParse();
        var masterOp: int = masterMsgSlice.loadOp();
        masterMsgSlice.skipQueryId();
        // parse-validate messages
        if (masterOp == OP_TRANSFER) {
            // see transfer TL-B layout in jetton.tlb
            masterMsgSlice.loadCoins(); // jetton_amount
            masterMsgSlice.loadAddress(); // to_owner_address
            masterMsgSlice.loadAddress(); // response_address
            masterMsgSlice.skipMaybeRef(); // custom_payload
            var forwardTonAmount: int = masterMsgSlice.loadCoins(); // forward_ton_amount
            checkEitherForwardPayload(masterMsgSlice); // either_forward_payload

            checkAmountIsEnoughToTransfer(tonAmount, forwardTonAmount, fwdFee);

        } else if (masterOp == OP_BURN) {
            // see burn TL-B layout in jetton.tlb
            masterMsgSlice.loadCoins(); // jetton_amount
            masterMsgSlice.loadAddress(); // response_address
            masterMsgSlice.skipMaybeRef(); // custom_payload
            masterMsgSlice.assertEnd();

            checkAmountIsEnoughToBurn(tonAmount);

        } else if (masterOp == OP_SET_STATUS) {
            masterMsgSlice.loadUint(STATUS_SIZE); // status
            masterMsgSlice.assertEnd();
        } else {
            throw ERROR_INVALID_OP;
        }
        sendToJettonWallet(toAddress, jettonWalletCode, tonAmount, masterMsg, FALSE);
        return;
    }

    if (op == OP_CHANGE_METADATA_URI) {
        assert(senderAddress.bitsEqual(adminAddress)) throw ERROR_NOT_OWNER;
        saveData(totalSupply, adminAddress, nextAdminAddress, jettonWalletCode, beginCell().storeSlice(inMsgBody).endCell());
        return;
    }

    if (op == OP_UPGRADE) {
        assert(senderAddress.bitsEqual(adminAddress)) throw ERROR_NOT_OWNER;
        var (newData: cell, newCode: cell) = (inMsgBody.loadRef(), inMsgBody.loadRef());
        inMsgBody.assertEnd();
        contract.setData(newData);
        contract.setCodePostponed(newCode);
        return;
    }

    if (op == OP_TOP_UP) {
        return; // just accept tons
    }

    throw ERROR_WRONG_OP;
}

@inline
fun buildContentCell(metadataUri: slice): cell {
    var contentDict: cell = createEmptyDict();
    contentDict.setTokenSnakeMetadataEntry(stringSha256("uri"), metadataUri);
    contentDict.setTokenSnakeMetadataEntry(stringSha256("decimals"), "6");
    return createTokenOnchainMetadata(contentDict);
}

get fun get_jetton_data(): (int, int, slice, cell, cell) {
    var (totalSupply: int, adminAddress: address, nextAdminAddress: address, jettonWalletCode: cell, metadataUri: cell) = loadData();
    return (totalSupply, TRUE, adminAddress, buildContentCell(metadataUri.beginParse()), jettonWalletCode);
}

get fun get_wallet_address(ownerAddress: address): address {
    var (totalSupply: int, adminAddress: address, nextAdminAddress: address, jettonWalletCode: cell, metadataUri: cell) = loadData();
    return calculateUserJettonWalletAddress(ownerAddress, contract.getAddress(), jettonWalletCode);
}

get fun get_next_admin_address(): address {
    var (totalSupply: int, adminAddress: address, nextAdminAddress: address, jettonWalletCode: cell, metadataUri: cell) = loadData();
    return nextAdminAddress;
}

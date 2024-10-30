// Jetton minter smart contract

tolk 0.6

import "@stdlib/tvm-dicts"


import "op-codes.tolk"
import "workchain.tolk"
import "jetton-utils.tolk"
import "gas.tolk"

// storage#_ total_supply:Coins admin_address:MsgAddress next_admin_address:MsgAddress jetton_wallet_code:^Cell metadata_uri:^Cell = Storage;
@inline
fun loadData(): (int, slice, slice, cell, cell) {
    var ds: slice = getContractData().beginParse();
    var data = (
        ds.loadCoins(), // total_supply
        ds.loadAddress(), // admin_address
        ds.loadAddress(), // next_admin_address
        ds.loadRef(),  // jetton_wallet_code
        ds.loadRef()  // metadata url (contains snake slice without 0x0 prefix)
    );
    ds.assertEndOfSlice();
    return data;
}

@inline
fun saveData(totalSupply: int, adminAddress: slice, nextAdminAddress: slice, jettonWalletCode: cell, metadataUri: cell) {
    setContractData(
        beginCell()
        .storeCoins(totalSupply)
        .storeSlice(adminAddress)
        .storeSlice(nextAdminAddress)
        .storeRef(jettonWalletCode)
        .storeRef(metadataUri)
        .endCell()
    );
}

@inline
fun sendToJettonWallet(toAddress: slice, jettonWalletCode: cell, tonAmount: int, masterMsg: cell, needStateInit: int) {
    reserveToncoinsOnBalance(ONE_TON, RESERVE_REGULAR); // reserve for storage fees

    var stateInit: cell = calculateJettonWalletStateInit(toAddress, getMyAddress(), jettonWalletCode);
    var toWalletAddress: slice = calculateJettonWalletAddress(stateInit);

    // build MessageRelaxed, see TL-B layout in stdlib.fc#L733
    var msg = beginCell()
    .storeMsgFlagsAndAddressNone(BOUNCEABLE)
    .storeSlice(toWalletAddress) // dest
    .storeCoins(tonAmount);

    if (needStateInit) {
        msg = msg.storeStatinitRefAndBodyRef(stateInit, masterMsg);
    } else {
        msg = msg.storeOnlyBodyRef(masterMsg);
    }

    sendRawMessage(msg.endCell(), SEND_MODE_PAY_FEES_SEPARATELY | SEND_MODE_BOUNCE_ON_ACTION_FAIL);
}

fun onInternalMessage(msgValue: int, inMsgFull: cell, inMsgBody: slice) {
    var inMsgFullSlice: slice = inMsgFull.beginParse();
    var msgFlags: int = inMsgFullSlice.loadMsgFlags();

    if (msgFlags & 1) { // is bounced
        inMsgBody.skipBouncedPrefix();
        // process only mint bounces
        if (!(inMsgBody.loadOp() == `op::internal_transfer`)) {
            return;
        }
        inMsgBody.skipQueryId();
        var jettonAmount: int = inMsgBody.loadCoins();
        var (totalSupply: int, adminAddress: slice, nextAdminAddress: slice, jettonWalletCode: cell, metadataUri: cell) = loadData();
        saveData(totalSupply - jettonAmount, adminAddress, nextAdminAddress, jettonWalletCode, metadataUri);
        return;
    }
    var senderAddress: slice = inMsgFullSlice.loadAddress();
    var fwdFeeFromInMsg: int = inMsgFullSlice.retrieveFwdFee();
    var fwdFee: int = getOriginalFwdFee(MY_WORKCHAIN, fwdFeeFromInMsg); // we use message fwd_fee for estimation of forward_payload costs

    var (op: int, queryId: int) = inMsgBody.loadOpAndQueryId();

    var (totalSupply: int, adminAddress: slice, nextAdminAddress: slice, jettonWalletCode: cell, metadataUri: cell) = loadData();

    if (op == `op::mint`) {
        assert(equalSlicesBits(senderAddress, adminAddress)) throw `error::not_owner`;
        var toAddress: slice = inMsgBody.loadAddress();
        checkSameWorkchain(toAddress);
        var tonAmount: int = inMsgBody.loadCoins();
        var masterMsg: cell = inMsgBody.loadRef();
        inMsgBody.assertEndOfSlice();

        // see internal_transfer TL-B layout in jetton.tlb
        var masterMsgSlice: slice = masterMsg.beginParse();
        assert(masterMsgSlice.loadOp() == `op::internal_transfer`) throw `error::invalid_op`;
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

    if (op == `op::burn_notification`) {
        // see burn_notification TL-B layout in jetton.tlb
        var jettonAmount: int = inMsgBody.loadCoins();
        var fromAddress: slice = inMsgBody.loadAddress();
        assert(equalSlicesBits(calculateUserJettonWalletAddress(fromAddress, getMyAddress(), jettonWalletCode), senderAddress)) throw `error::not_valid_wallet`;
        saveData(totalSupply - jettonAmount, adminAddress, nextAdminAddress, jettonWalletCode, metadataUri);
        var responseAddress: slice = inMsgBody.loadAddress();
        inMsgBody.assertEndOfSlice();

        if (~ isAddressNone(responseAddress)) {
            // build MessageRelaxed, see TL-B layout in stdlib.fc#L733
            var msg = beginCell()
            .storeMsgFlagsAndAddressNone(NON_BOUNCEABLE)
            .storeSlice(responseAddress) // dest
            .storeCoins(0)
            .storePrefixOnlyBody()
            .storeOp(`op::excesses`)
            .storeQueryId(queryId);
            sendRawMessage(msg.endCell(), SEND_MODE_IGNORE_ERRORS | SEND_MODE_CARRY_ALL_REMAINING_MESSAGE_VALUE);
        }
        return;
    }

    if (op == `op::provide_wallet_address`) {
        // see provide_wallet_address TL-B layout in jetton.tlb
        var ownerAddress: slice = inMsgBody.loadAddress();
        var isIncludeAddress: int = inMsgBody.loadBool();
        inMsgBody.assertEndOfSlice();

        var includedAddress: cell = isIncludeAddress
        ? beginCell().storeSlice(ownerAddress).endCell()
        : null;

        // build MessageRelaxed, see TL-B layout in stdlib.fc#L733
        var msg = beginCell()
        .storeMsgFlagsAndAddressNone(NON_BOUNCEABLE)
        .storeSlice(senderAddress)
        .storeCoins(0)
        .storePrefixOnlyBody()
        .storeOp(`op::take_wallet_address`)
        .storeQueryId(queryId);

        if (isSameWorkchain(ownerAddress)) {
            msg = msg.storeSlice(calculateUserJettonWalletAddress(ownerAddress, getMyAddress(), jettonWalletCode));
        } else {
            msg = msg.storeAddressNone();
        }

        var msgCell: cell = msg.storeMaybeRef(includedAddress).endCell();

        sendRawMessage(msgCell, SEND_MODE_CARRY_ALL_REMAINING_MESSAGE_VALUE | SEND_MODE_BOUNCE_ON_ACTION_FAIL);
        return;
    }

    if (op == `op::change_admin`) {
        assert(equalSlicesBits(senderAddress, adminAddress)) throw `error::not_owner`;
        nextAdminAddress = inMsgBody.loadAddress();
        inMsgBody.assertEndOfSlice();
        saveData(totalSupply, adminAddress, nextAdminAddress, jettonWalletCode, metadataUri);
        return;
    }

    if (op == `op::claim_admin`) {
        inMsgBody.assertEndOfSlice();
        assert(equalSlicesBits(senderAddress, nextAdminAddress)) throw `error::not_owner`;
        saveData(totalSupply, nextAdminAddress, createAddressNone(), jettonWalletCode, metadataUri);
        return;
    }

    // can be used to lock, unlock or reedem funds
    if (op == `op::call_to`) {
        assert(equalSlicesBits(senderAddress, adminAddress)) throw `error::not_owner`;
        var toAddress: slice = inMsgBody.loadAddress();
        var tonAmount: int = inMsgBody.loadCoins();
        var masterMsg: cell = inMsgBody.loadRef();
        inMsgBody.assertEndOfSlice();

        var masterMsgSlice: slice = masterMsg.beginParse();
        var masterOp: int = masterMsgSlice.loadOp();
        masterMsgSlice.skipQueryId();
        // parse-validate messages
        if (masterOp == `op::transfer`) {
            // see transfer TL-B layout in jetton.tlb
            masterMsgSlice.loadCoins(); // jetton_amount
            masterMsgSlice.loadAddress(); // to_owner_address
            masterMsgSlice.loadAddress(); // response_address
            masterMsgSlice.skipMaybeRef(); // custom_payload
            var forwardTonAmount: int = masterMsgSlice.loadCoins(); // forward_ton_amount
            checkEitherForwardPayload(masterMsgSlice); // either_forward_payload

            checkAmountIsEnoughToTransfer(tonAmount, forwardTonAmount, fwdFee);

        } else if (masterOp == `op::burn`) {
            // see burn TL-B layout in jetton.tlb
            masterMsgSlice.loadCoins(); // jetton_amount
            masterMsgSlice.loadAddress(); // response_address
            masterMsgSlice.skipMaybeRef(); // custom_payload
            masterMsgSlice.assertEndOfSlice();

            checkAmountIsEnoughToBurn(tonAmount);

        } else if (masterOp == `op::set_status`) {
            masterMsgSlice.loadUint(STATUS_SIZE); // status
            masterMsgSlice.assertEndOfSlice();
        } else {
            throw `error::invalid_op`;
        }
        sendToJettonWallet(toAddress, jettonWalletCode, tonAmount, masterMsg, FALSE);
        return;
    }

    if (op == `op::change_metadata_uri`) {
        assert(equalSlicesBits(senderAddress, adminAddress)) throw `error::not_owner`;
        saveData(totalSupply, adminAddress, nextAdminAddress, jettonWalletCode, beginCell().storeSlice(inMsgBody).endCell());
        return;
    }

    if (op == `op::upgrade`) {
        assert(equalSlicesBits(senderAddress, adminAddress)) throw `error::not_owner`;
        var (newData: cell, newCode: cell) = (inMsgBody.loadRef(), inMsgBody.loadRef());
        inMsgBody.assertEndOfSlice();
        setContractData(newData);
        setContractCodePostponed(newCode);
        return;
    }

    if (op == `op::top_up`) {
        return; // just accept tons
    }

    throw `error::wrong_op`;
}

@inline
fun buildContentCell(metadataUri: slice): cell {
    var contentDict: cell = createEmptyDict();
    contentDict.setTokenSnakeMetadataEntry("uri"H, metadataUri);
    contentDict.setTokenSnakeMetadataEntry("decimals"H, "6");
    return createTokenOnchainMetadata(contentDict);
}

get get_jetton_data(): (int, int, slice, cell, cell) {
    var (totalSupply: int, adminAddress: slice, nextAdminAddress: slice, jettonWalletCode: cell, metadataUri: cell) = loadData();
    return (totalSupply, TRUE, adminAddress, buildContentCell(metadataUri.beginParse()), jettonWalletCode);
}

get get_wallet_address(ownerAddress: slice): slice {
    var (totalSupply: int, adminAddress: slice, nextAdminAddress: slice, jettonWalletCode: cell, metadataUri: cell) = loadData();
    return calculateUserJettonWalletAddress(ownerAddress, getMyAddress(), jettonWalletCode);
}

get get_next_admin_address(): slice {
    var (totalSupply: int, adminAddress: slice, nextAdminAddress: slice, jettonWalletCode: cell, metadataUri: cell) = loadData();
    return nextAdminAddress;
}

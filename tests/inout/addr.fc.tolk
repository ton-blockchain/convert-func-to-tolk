@inline
fun saveData(totalSupply: int, adminAddress: address, content: cell, jettonWalletCode: cell) {
    contract.setData(beginCell()
        .storeCoins(totalSupply)
        .storeAddress(adminAddress)
        .storeRef(content)
        .storeRef(jettonWalletCode)
        .endCell()
    );
}

// in the future, use: fun onInternalMessage(in: InMessage) {
fun onInternalMessage(msgValue: int, inMsgFull: cell, inMsgBody: slice) {
    if (inMsgBody.isEmpty()) { // ignore empty messages
        return;
    }
    var cs: slice = inMsgFull.beginParse();
    var flags: int = cs.loadUint(4);

    if (flags & 1) { // ignore all bounced messages
        return;
    }
    var senderAddress: address = cs.loadAddress();

    var toWalletAddress: address = calculateJettonWalletAddress(state_init);

    var (totalSupply: int, adminAddress: address, content: cell, jettonWalletCode: cell) = loadData();
}

const {createG3} = require("g3.js");
const G3Utils = require("g3-utils");
const config = require("../config");

const chai = require("chai");
require("chai")
    .use(require("chai-as-promised"))
    .should();

const should = chai.should();

describe("Test cases", function () {

  it("transaction", async () => {
      const g3 = createG3(config);
      const contract = await g3.contract(config.account);
      await contract.hi("me", 30, "It is a test", {authorization: [config.account + `@active`]});
  });


  it("block", async () => {

      const g3 = createG3(config);
      const contract = await g3.contract(config.account);
      const result = await contract.hi("me", 30, "It is a test", {authorization: [config.account + `@active`]});


      // first check whether the transaction was failed
      if (!result || result.processed.receipt.status !== "executed") {
          console.log("the transaction was failed");
          return;
      }

      // then check whether the transaction was irreversible when it was not expired
      let timeout = new Date(result.transaction.transaction.expiration + "Z") - new Date();
    let finalResult = false;
    try {
        await G3Utils.test.waitUntil(async () => {
            let tx = await g3.getTxByTxId(result.transaction_id);
            finalResult = tx && tx.irreversible;
            if (finalResult) return true;
        }, timeout, 1000);
    } catch (e) {
      console.log(finalResult);
    }
  });
});

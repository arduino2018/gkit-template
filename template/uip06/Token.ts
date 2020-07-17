/**
 * @author gchain
 */
import { Contract } from "gchain-ts-lib/src/contract";
import { Asset, StringToSymbol } from "gchain-ts-lib/src/asset";
import { TransferParams } from "gchain-ts-lib/src/action";
import { PermissionLevel } from "gchain-ts-lib/src/permission-level";
import { env as action } from "gchain-ts-lib/internal/action.d";
import { CurrencyStats, CurrencyAccount } from "gchain-ts-lib/lib/balance";
import { NAME, Account, RNAME } from "gchain-ts-lib/src/account";
import { NEX, NameEx} from "gchain-ts-lib/lib/name_ex";
import { Action } from "gchain-ts-lib/src/action";
import { UIP06 } from "gchain-ts-lib/uips/uip06";

const StatsTable  : string = "stat";
const AccountTable: string = "accounts";

@database(CurrencyStats, StatsTable)
@database(CurrencyAccount, AccountTable)
class Token extends Contract implements UIP06{
  @action
  public create(issuer: account_name, maximum_supply: Asset): void {
    Action.requireAuth (this.receiver);
    let sym = maximum_supply.symbolName();
    gchain_assert(maximum_supply.isSymbolValid(), "token.create: invalid symbol name.");
    gchain_assert(maximum_supply.isValid(), "token.create: invalid supply.");

    let statstable: DBManager<CurrencyStats> = new DBManager<CurrencyStats>(NAME(StatsTable), sym);
    let cs: CurrencyStats = new CurrencyStats();

    let existing = statstable.get(sym, cs);
    gchain_assert(!existing, "token with symbol already exists.");

    cs.supply.setSymbol(maximum_supply.getSymbol());
    cs.max_supply = maximum_supply;
    cs.issuer = issuer;
    statstable.emplace(cs);
  }

  @action
  public issue(to: account_name, quantity: Asset, memo: string): void {
    gchain_assert(quantity.isSymbolValid(), "token.issue: invalid symbol name");
    gchain_assert(memo.length <= 256, "token.issue: memo has more than 256 bytes.");

    let statstable: DBManager<CurrencyStats> = new DBManager<CurrencyStats>(NAME(StatsTable), quantity.symbolName());
    let st: CurrencyStats = new CurrencyStats();
    let existing = statstable.get(quantity.symbolName(), st);

    gchain_assert(existing, "token.issue: symbol name is not exist.");

    Action.requireAuth(st.issuer);
    gchain_assert(quantity.isValid(), "token.issue: invalid quantity.");
    gchain_assert(quantity.getSymbol() == st.max_supply.getSymbol(), "token.issue: symbol precision mismatch.");
    gchain_assert(quantity.getAmount() <= st.max_supply.getAmount() - st.supply.getAmount(), "token.issue: quantity exceeds available supply.");

    let amount = st.supply.getAmount() + quantity.getAmount();
    st.supply.setAmount(amount);
    statstable.modify(st);
    this.addBalance(st.issuer, quantity);
    if (to != st.issuer) {
      let pl: PermissionLevel = new PermissionLevel();
      pl.actor = st.issuer;
      pl.permission = "active";
      let params = new TransferParams(0, 0, new Asset(), "");
      params.from = st.issuer;
      params.to = to;
      params.quantity = quantity;
      params.memo = memo;
      let name = "transfer";
      Action.sendInline([pl], RNAME(this.receiver), name, params);
    }
  }

  @action
  public transfer(from: account_name, to: account_name, quantity: Asset, memo: string): void {
    gchain_assert(from != to, "token.transfer: cannot transfer to self.");
    Action.requireAuth(from);
    gchain_assert(Account.isValid(to), "token.transfer: to account does not exist.");

    // let symname: SymbolName = quantity.symbolName();
    let statstable: DBManager<CurrencyStats> = new DBManager<CurrencyStats>(NAME(StatsTable), quantity.symbolName());
    let st: CurrencyStats = new CurrencyStats()
    let existing = statstable.get(quantity.symbolName(), st);

    gchain_assert(existing, "token.transfer symbol name is not exist.");

    Action.requireRecipient(from);
    Action.requireRecipient(to);

    gchain_assert(quantity.isValid(), "token.transfer: invalid quantity.");
    gchain_assert(quantity.getSymbol() == st.supply.getSymbol(), "token.transfer: symbol precision mismatch.");
    gchain_assert(memo.length <= 256, "token.transfer: memo has more than 256 bytes.");

    this.subBalance(from, quantity);
    this.addBalance(to, quantity);
  }


  @action("pureview")
  public totalSupply(sym_name: string): Asset {
    let symname = StringToSymbol(0, sym_name) >> 8;
    let statstable: DBManager<CurrencyStats> = new DBManager<CurrencyStats>(NAME(StatsTable), symname);
    let st = new CurrencyStats();
    let existing = statstable.get(symname, st);
    gchain_assert(existing, "totalSupply failed, stats is not existed.");
    return st.max_supply;
  }

  @action("pureview")
  public getSupply(sym_name: string): Asset {
    let symname = StringToSymbol(0, sym_name) >> 8;
    let statstable: DBManager<CurrencyStats> = new DBManager<CurrencyStats>(NAME(StatsTable), symname);
    let st = new CurrencyStats();
    let existing = statstable.get(symname, st);
    gchain_assert(existing, "getSupply failed, stats is not existed.");
    return st.supply;
  }

  @action("pureview")
  public balanceOf(owner: account_name, sym_name: string): Asset {
    let symname: u64 = StringToSymbol(0, sym_name) >> 8;
    let accounts: DBManager<CurrencyAccount> = new DBManager<CurrencyAccount>(NAME(AccountTable), owner);
    let account = new CurrencyAccount(new Asset());
    let existing = accounts.get(symname, account);
    gchain_assert(existing, "balanceOf failed, account is not existed.")

    return account.balance;
  }

  private subBalance(owner: account_name, value: Asset): void {
    let ats: DBManager<CurrencyAccount> = new DBManager<CurrencyAccount>(NAME(AccountTable), owner);
    let from: CurrencyAccount = new CurrencyAccount(new Asset());
    let existing = ats.get(value.symbolName(), from);

    gchain_assert(existing, "token.subBalance: from account is not exist.");
    gchain_assert(from.balance.getAmount() >= value.getAmount(), "token.subBalance: overdrawing balance.");

    if (from.balance.getAmount() == value.getAmount()) {
      ats.erase(from.primaryKey());
    } else {
      let amount = from.balance.getAmount() - value.getAmount();
      from.balance.setAmount(amount);
      ats.modify(from);
    }
  }

  private addBalance(owner: u64, value: Asset): void {
    let toaccount: DBManager<CurrencyAccount> = new DBManager<CurrencyAccount>(NAME(AccountTable), owner);
    let to: CurrencyAccount = new CurrencyAccount(new Asset());
    let existing = toaccount.get(value.symbolName(), to);

    if (!existing) {
      let a: CurrencyAccount = new CurrencyAccount(value);
      toaccount.emplace(a);
    } else {
      let amount = to.balance.getAmount() + value.getAmount();
      to.balance.setAmount(amount);
      toaccount.modify(to);
    }
  }


  public totalSupplies(): Asset[] {
    throw new Error('Method not implemented.');
  }

}

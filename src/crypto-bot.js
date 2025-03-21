import { yellowBright, cyanBright, redBright, greenBright, magentaBright } from 'ansis';
import App from './app/app.js';
import fs from 'fs';
import EcaStacker from './strategies/eca-stacker.js';
import BotSettings from './data/bot-settings.js';
import ClientBase from './services/client.js';
import ExchangeOrder from './data/exchange-order.js';
import EcaTrader from './strategies/eca-trader.js';
import TelegramCryptoBot from './services/telegram-bot.js';
import Strategy from './strategies/strategy.js';
import Utils from './utils.js';
import ExchangeClient from './services/exchange-client.js';
import CoinMarketCapClient from './services/coinmarketcap.js';
import Terminal from './app/terminal.js';
import CommandLineInterface from './app/cli.js';

export default class CryptoBot {
  /**
   * @type {import ('./types.js').Settings}
   */
  #settings = {};

  /** @type {Object.<string, ClientBase>} */
  #clients = {};
  #activeBots = [];

  /**
   * @type { {telegram?: TelegramCryptoBot, coinmarketcap?: CoinMarketCapClient, cli?: CommandLineInterface}}
   */
  #services = {};

  coinmarketcapClient;

  /** @type {ExchangeClient} */
  ccxtClient;

  constructor() {
    this.loadSettings();
  }

  async init() {
    this.#services['cli'] = new CommandLineInterface(this);
    var term = new Terminal();
    term.init(this);
    await term.disableInput();

    term.log('^MStarting Crypto-Bot v1.0 by NomadSoul', true);
    Object.keys(this.#settings.accounts).forEach((accountId) => {
      var accountSettings = this.getAccountSettings(accountId);
      accountSettings.id = accountId;
      switch (accountSettings.type.toLowerCase()) {
        case 'kraken':
        case 'coinbase':
          this.#clients[accountId] = new ExchangeClient(accountSettings);
          break;

        default:
          term.error(`${accountId}: invalid exchange.`);
          break;
      }
    });

    Object.keys(this.#settings.services).forEach((serviceId) => {
      switch (serviceId) {
        case 'telegram': {
          let telegramBot = new TelegramCryptoBot(this.#settings.services.telegram);
          this.#services['telegram'] = telegramBot;
          break;
        }
        case 'coinmarketcap':
          this.coinmarketcapClient = new CoinMarketCapClient(this.#settings.services.coinmarketcap);
          break;
        default:
          term.error(`${serviceId}: invalid service.`);
          break;
      }
    });

    Object.values(this.#settings.bots).forEach((bot) => {
      switch (bot.strategyType) {
        case 'stacker':
          bot.strategy = new EcaStacker(this, bot.id);
          break;
        case 'trader':
          bot.strategy = new EcaTrader(this, bot.id);
          break;
      }
      if (bot.active) this.#activeBots.push(bot.id);
    });
    term.log(`^MCrypto-Bot listening on port ${this.getServerPort().toString()}`, true);
  }

  // async rebuildHistory(account = null, refresh = false) {
  //   var promises = [];
  //   var accountsToCheck = [];

  //   if (account === null) accountsToCheck = Object.entries(this.#clients);
  //   else accountsToCheck.push([account, this.#clients[account]]);

  //   if (refresh) {
  //     // Download all orders
  //     accountsToCheck.forEach((/** @type {[string, ClientBase]} */ [key, client]) => {
  //       promises.push(client.rebuildHistory());
  //     });
  //   }
  //   return this.recoverDeals();
  // }

  /**
   * @returns {string}
   */
  get appCurrency() {
    return this.#settings.locale.currency ?? 'eur';
  }

  getClientSettings() {
    var data = {};
    Object.values(this.#settings.accounts).forEach((account) => {
      data[account.id] = {
        watchBalance: account.watchBalance,
        showDealPreview: account.showDealPreview,
        tradeBalance: account.tradeBalance,
        purchaseHistory: account.purchaseHistory,
        stackingHistory: account.stackingHistory,
        strategy: account.strategyType,
      };
    });

    return data;
  }

  getAccounts() {
    return Object.keys(this.#clients);
  }

  getAvailableExchanges() {
    var exchanges = [...new Set(Object.values(this.#clients).map((client) => client.type))];
    return exchanges;
  }

  getLocalSettings() {
    return this.#settings.locale;
  }

  getServerPort() {
    return this.#settings.serverPort;
  }

  getTraderBotIds() {
    return Object.values(this.#settings.bots)
      .filter((bot) => bot.strategyType === 'trader')
      .map((botSettings) => botSettings.id);
  }

  /**
   *
   * @param {string} id
   * @returns {import('./types.js').AccountSettings}
   */
  getAccountSettings(id) {
    return this.#settings.accounts[id];
  }

  /**
   *
   * @param {string} accountId
   * @returns {ClientBase}
   */
  getClient(accountId) {
    var accountClient = this.#clients[accountId];
    if (typeof accountClient === 'undefined') Terminal.error(`Unknown account ${accountId}`);
    return accountClient;
  }

  /**
   * @param {string} accountId
   * @returns {boolean}
   */
  hasClient(accountId) {
    var accountClient = this.#clients[accountId];
    if (typeof accountClient === 'undefined') return false;
    else return true;
  }

  // /**
  //  * @param {string} id
  //  * @param {EcaOrder} plannedOrder
  //  */
  // setPlannedOrder(id, plannedOrder) {
  //   this.#plannedOrders.set(id, plannedOrder);
  // }

  // /**
  //  *
  //  * @param {EcaOrder[]} orders
  //  */
  // addPlannedOrders(orders) {
  //   if (typeof orders === 'undefined') Terminal.error('Attempted to add empty EcaOrder');
  //   orders.forEach((order) => this.setPlannedOrder(order.id, order));
  // }

  // /**
  //  *
  //  * @param {EcaOrder} order
  //  */
  // deletePlannedOrder(order) {
  //   if (typeof order === 'undefined' || !this.hasPlannedOrder(order.id)) Terminal.error('Attempted to remove unknown EcaOrder');
  //   this.#plannedOrders.delete(order.id);
  // }

  /**
   *
   * @param {string} account
   * @returns
   */
  async downloadOrders(account = null) {
    var term = Terminal.instance;
    var promises = [];

    /** @type {[string, ClientBase][]} */
    var accountsToCheck = [];
    if (account === null) accountsToCheck = Object.entries(this.#clients);
    else accountsToCheck.push([account, this.#clients[account]]);

    accountsToCheck
      .filter(([key, client]) => client.active)
      .forEach(([key, client]) => {
        var dateNow = new Date();
        var deltaTime = Math.abs(client.lastClosedOrdersCheck.getTime() - dateNow.getTime()) / 3600000;
        if (isNaN(deltaTime) || deltaTime > 5) {
          term.log(
            `^C${client.id}^:: orders last checked: ^y${isNaN(deltaTime) ? 'never' : `${deltaTime.toFixed(2)} minutes ago `}^ --> ^Yupdating^ now`,
            true,
          );
          promises.push(
            client.requestOrdersByStatus('open', true).then(() => {
              client.lastOpenOrdersCheck = new Date();
              this.#settings.accounts[client.id].lastOpenOrdersCheck = client.lastOpenOrdersCheck;
            }),
          );
          promises.push(
            client.requestOrdersByStatus('closed', true).then(() => {
              client.lastClosedOrdersCheck = new Date();
              this.#settings.accounts[client.id].lastClosedOrdersCheck = client.lastClosedOrdersCheck;
            }),
          );
        } else term.log(`^C${client.id}^:: orders last checked: ${deltaTime.toFixed(2)} minutes ago > proceeding`);
        promises.push(client.requestBalance());
      });

    return Promise.all(promises);
  }

  async updatePrices() {
    var pairMap = new Map();

    Object.entries(this.#settings.bots).forEach(([botId, botSettings]) => {
      if (!pairMap.has(botSettings.account)) {
        pairMap.set(botSettings.account, []);
      }
      let accountClient = this.getClient(botSettings.account);
      if (typeof accountClient !== 'undefined') {
        pairMap.get(botSettings.account).push(accountClient.getPairId(botSettings).toUpperCase());
      }
    });

    var promises = [];

    [...pairMap.entries()].forEach(([key, tickers]) => {
      let client = this.getClient(key);
      let promise = client.requestTickers(tickers).then((response) => client.updateTickers(response));
      promises.push(promise);
    });

    return Promise.allSettled(promises);
  }

  // listMissingLocalOrders() {
  //   let data = this.getPlannedOrders('all');
  //   var missingOrders = new Map();
  //   Object.keys(this.#clients).forEach((account) => missingOrders.set(account, []));
  //   var filtered = data
  //     .filter((order) => order.status === 'executed' && this.hasActiveClient(order.account) && !this.getClient(order.account).hasLocalExchangeOrder(order.txid))
  //     .forEach((order) => {
  //       missingOrders.get(order.account).push(order.txid ?? order.id);
  //       if (!order.txid) Terminal.warning(`Order ${order.id} contains empty txid`);
  //     });

  //   return missingOrders;
  // }

  // /**
  //  *
  //  * @param {string} botId
  //  * @returns {ExchangeOrder[]}
  //  */
  // getPlannedOrders(botId) {
  //   let data = [...this.#plannedOrders.values()];
  //   if (botId === 'all') return data;
  //   else return data.filter((entry) => entry.botId === botId);
  // }

  /**
   *
   * @param {string} botId
   * @returns {Map<string, ExchangeOrder[]>}
   */
  getPlannedOrders(botId = null) {
    var botsToCheck = [];
    if (botId == null) {
      botsToCheck = Object.keys(this.#settings.bots);
    } else {
      botsToCheck.push(botId);
    }

    var ordersByBot = new Map();
    for (botId in this.#settings.bots) {
      let bot = this.getBotSettings(botId);
      let client = this.getClient(bot.account);
      let orders = Array.from(client.orders.values());
      ordersByBot.set(botId, orders);
    }

    return ordersByBot;
  }

  update() {
    var pricePromise = this.updatePrices();
    var syncPromise = this.syncExchangeStatus();

    return Promise.all([pricePromise, syncPromise])
      .then(() => this.processPlans())
      .then(() => Terminal.instance.restoreInput());
  }
  // /**
  //  *
  //  * @param {string} id
  //  * @returns {EcaOrder | null}
  //  */
  // getPlannedOrder(id) {
  //   if (!this.#plannedOrders.has(id)) {
  //     Terminal.warning(`Planned order ${id} not found`);
  //     return null;
  //   }

  //   return this.#plannedOrders.get(id);
  // }

  // /**
  //  *
  //  * @param {string} id
  //  * @returns
  //  */
  // hasPlannedOrder(id) {
  //   return this.#plannedOrders.has(id);
  // }

  // /**
  //  *
  //  * @param {string} txid
  //  * @param {string} botId
  //  * @returns {EcaOrder | undefined}
  //  */
  // getPlannedOrderByTxid(txid, botId = undefined) {
  //   var orders;
  //   if (typeof botId !== 'undefined') orders = this.getPlannedOrders(botId);
  //   else orders = this.getPlannedOrders('all');

  //   return orders.find((o) => o.txid === txid);
  // }

  // /**
  //  *
  //  * @param {string} id
  //  * @param {string} account
  //  * @returns
  //  */
  // getLocalExchangeOrderFromPlannedOrderId(id, account) {
  //   var accountClient = this.getClient(account);
  //   return accountClient.getLocalOrder(this.getPlannedOrder(id).txid);
  // }

  // async getExchangeOrderFromPlannedOrderId(id, account, redownload = false) {
  //   var accountClient = this.getClient(account);
  //   return accountClient.getExchangeOrder(this.getPlannedOrder(id).txid, redownload);
  // }

  // /**
  //  *
  //  * @param {string[]} ids
  //  * @param {string} account
  //  * @param {boolean} redownload
  //  */
  // async getExchangeOrdersFromPlannedOrderIds(ids, account, redownload = false) {
  //   var accountClient = this.getClient(account);

  //   var exchangeOrders = ids
  //     .map((id) => this.getPlannedOrder(id))
  //     .filter((order) => order.txid)
  //     .map((order) => accountClient.getExchangeOrder(order.txid, redownload));

  //   return Promise.all(exchangeOrders);
  // }

  // /**
  //  *
  //  * @param {string[]} ids
  //  * @param {string} account
  //  */
  // getLocalExchangeOrdersFromPlannedOrderIds(ids, account) {
  //   var accountClient = this.getClient(account);

  //   var exchangeOrders = ids
  //     .map((id) => this.getPlannedOrder(id))
  //     .filter((order) => order.txid)
  //     .map((order) => accountClient.getLocalOrder(order.txid));

  //   return exchangeOrders;
  // }

  /**
   *
   * @param {string} botId
   * @returns {BotSettings}
   */
  getBotSettings(botId) {
    let botSettings = this.#settings.bots;
    if (typeof botId === 'undefined') Terminal.error(`No settings found for ${botId}`);
    else return botSettings[botId];
  }

  hasBot(botId) {
    return typeof this.#settings.bots[botId] !== 'undefined';
  }

  /**
   *
   * @returns {Object.<string,BotSettings>}
   */
  getAllBots() {
    return this.#settings.bots;
  }

  // selectPlanOrders(status) {
  //   return [...this.#plannedOrders.values()].filter((p) => p.status === status);
  // }

  // loadPlannedOrders() {
  //   Terminal.log('Loading planned orders');
  //   var data = App.readFileSync(`${App.DataPath}/crypto-bot-orders.json`);
  //   this.#plannedOrders = new Map(Object.keys(data).map((key) => [key, new EcaOrder(data[key])]));
  // }

  async loadSettings() {
    const settingsFile = `${App.DataPath}/settings.json`;

    if (!fs.existsSync(settingsFile)) {
      Terminal.error(`No settings file found in ${App.DataPath}`);
    }

    this.#settings = App.readFileSync(settingsFile);
    this.#settings.bots = Object.fromEntries(Object.entries(this.#settings.bots).map(([botId, botData]) => [botId, new BotSettings(botId, botData)]));

    if (!fs.existsSync(`${App.DataPath}/exchanges/`)) {
      Terminal.log(greenBright`Created 'exchanges' folder`);
      fs.mkdirSync(`${App.DataPath}/exchanges`, 0o755);
    }
    if (typeof this.#settings.locale !== 'undefined') App.locale = this.#settings.locale;
  }

  saveAllOrders(n = 50) {
    Object.entries(this.#clients).forEach(([id, accountClient]) => {
      let data = [...accountClient.orders.entries()].slice(-n);
      var dateNow = new Date(Date.now());
      let dataFiltered = {};

      for (const [key, order] of data) {
        try {
          let filter = order.openDate.getFullYear() === dateNow.getFullYear();
          if (filter) {
            dataFiltered[key] = order;
          }
        } catch (ex) {
          Terminal.printObject(order);
          Terminal.error(ex);
        }
      }
      accountClient.saveOrdersToFile(`${accountClient.id}-current-orders`, dataFiltered);
    });
  }

  /**
   * @param {string} [account]
   */
  async syncExchangeStatus(account) {
    return this.downloadOrders(account).then((response) => {
      App.writeFile(`${App.DataPath}/settings`, this.#settings, (key, value) => {
        if (key === 'strategy' && value instanceof Strategy) {
          return value.botSettings.strategyType;
        }
        if (key === 'strategyType') return undefined;
        return value;
      });
      return true;
    });
  }

  // async checkPendingOrders() {
  //   Terminal.log(greenBright`Checking pending orders`, true);
  //   let pendingPlannedOrders = [...this.#plannedOrders.values()].filter((entry) => entry.status === 'pending');
  //   let updateFile = false;

  //   for (let i = 0; i < pendingPlannedOrders.length; i++) {
  //     let plannedOrder = pendingPlannedOrders[i];

  //     let accountClient;
  //     if (this.hasActiveClient(plannedOrder.account)) {
  //       accountClient = this.getClient(plannedOrder.account);
  //     }
  //     else continue;
  //     let botSettings = this.getBotSettings(plannedOrder.botId);
  //     let exchangeOrder = await accountClient.getExchangeOrder(plannedOrder.txid);
  //     let check = await accountClient.checkPendingOrder(plannedOrder, exchangeOrder);

  //     Terminal.log(`CPO: ${plannedOrder.id}`);
  //     if (check.result) {
  //       switch (check.newStatus) {
  //         case 'executed': {
  //           let message = `[${greenBright`${plannedOrder.id}`}]: order ${greenBright`filled`} at ${plannedOrder.closeDate.toLocaleTimeString(App.locale.id)} for ${Number(exchangeOrder.price).toFixed(2)} (${Number(exchangeOrder.cost).toFixed(2)} ${botSettings.quote})`;
  //           Terminal.log(message, true);
  //           this.telegramBot.log(message);
  //           updateFile = true;
  //           break;
  //         }

  //         case 'cancelled': {
  //           let message = `[${greenBright`${plannedOrder.id}`}]: order ${redBright`cancelled`} at ${plannedOrder.closeDate.toLocaleTimeString(App.locale.id)}`;
  //           Terminal.warning(message);
  //           this.deletePlannedOrder(plannedOrder);
  //           updateFile = true;
  //           break;
  //         }

  //         default:
  //           Terminal.warning(`CPO: ${check.newStatus}`);
  //       }
  //     }
  //   }

  //   if (updateFile) this.updatePlanSchedule();
  //   return updateFile;
  // }

  // resetPlannedOrder(order) {
  //   order.status = 'planned';
  //   order.txid = '';
  //   this.updatePlanSchedule();
  // }

  // /**
  //  *
  //  * @param {Action} action
  //  * @returns {Promise<ExchangeOrder|any>}
  //  */
  // async processAction(action) {
  //   if (typeof action === 'undefined') throw new Error('Action is undefined');

  //   var response;
  //   var order = this.getPlannedOrder(action.plannedOrder.id);
  //   if (typeof order === 'undefined') throw new Error(`Cannot find order in ${action.command}`);
  //   var client = this.getClient(order.account);
  //   response = await client.processAction(action);

  //   if (typeof response === 'undefined') throw new Error(redBright`No response!`);

  //   switch (action.command) {
  //     case 'editOrder':
  //     case 'submitOrder': {
  //       if (action.isTest) {
  //         return;
  //       }

  //       Terminal.warning('Process Action');

  //       order.txid = client.getTxidFromResponse(response);
  //       Terminal.warning('Waiting 500 ms');
  //       await new Promise((resolve) => setTimeout(resolve, 500));

  //       let promise = new Promise((resolve) => resolve(client.updatePlannedOrder(order))).then((txinfo) => {
  //         if (typeof txinfo === 'undefined') {
  //           this.telegramBot.log(`Unexpected error when updating ${order.id}`);
  //           return;
  //         } else {
  //           this.telegramBot.log(
  //             `[${order.id}] submitted ${order.type} order ${order.direction} at ${txinfo.price} (${txinfo.cost.toFixed(2)} €) on ${order.account}`,
  //           );

  //           if (txinfo.status === 'open') client.requestOrdersByStatus('open');
  //           this.updatePlanSchedule();
  //           return txinfo;
  //         }
  //       });

  //       return promise;
  //     }

  //     case 'cancelOrder':
  //       Terminal.log(redBright`[${order.id}] cancelled ${order.account} order ${order.txid}`);
  //       return response;
  //   }
  // }

  // async recoverDeals() {
  //   Object.values(this.#settings.bots).forEach((botSettings) => {
  //     switch (botSettings.strategyType) {
  //       case 'stacker':
  //         if (this.getClient(botSettings.account) && typeof botSettings.strategy === 'undefined') {
  //           botSettings.strategy = new EcaStacker(this, botSettings.id);
  //           botSettings.strategy.rebuildHistory();
  //         }
  //         break;
  //     }
  //   });
  // }

  async processPlans() {
    var term = Terminal.instance;

    for (const botId of this.#activeBots) {
      var botSettings = this.getBotSettings(botId);
      if (botSettings == null) {
        term.warning(`${botId}: invalid strategy`);
        return;
      }

      if (!this.getAccountSettings(botSettings.account).active) {
        term.warning(`[${botId}]: account ${botSettings.account} is not active.`);
        return;
      }

      var shouldCheck = false;
      switch (botSettings.strategyType) {
        case 'stacker':
          shouldCheck = botSettings.strategy.hasActiveOrders();
          break;
        case 'trader':
          shouldCheck = botSettings.strategy.hasActiveOrders();
          break;
      }

      if (shouldCheck) {
        await botSettings.strategy.decide();
      } else {
        term.warning(`${botId}: no active orders`);
      }
    }

    return Promise.resolve();
  }

  /**
   *
   * @param {string} serviceType
   * @returns
   */
  getService(serviceType) {
    return this.#services[serviceType];
  }
}

import App from '../app/app.js';
import Utils from '../utils.js';
import fs from 'fs';
import { cyanBright, greenBright, magentaBright, redBright, yellowBright } from 'ansis';
import BotSettings from '../data/bot-settings.js';
import EcaOrder from '../data/eca-order.js';
import ExchangeOrder from '../data/exchange-order.js';
import Action from '../data/action.js';
import PairData from '../data/pair-data.js';
import Terminal from '../app/terminal.js';

export default class ClientBase {
  id = 'Abstract Client';
  apiPublicKey;
  apiPrivateKey;
  /** @type {Map<string,number>} */
  balances = new Map();
  pairs = new Map();
  prices = new Map();
  type;
  watchBalance;
  /** @type {Number} */
  historyStartYear;

  /** @type {boolean} */
  #updateLocalOrders;
  /** @type {Promise<any>} */
  pricePromise;

  /** @type {Promise<[string, number][]>} */
  balancePromise;

  /**
   * @type {Map<string, ExchangeOrder>}
   */
  orders = new Map();
  /** @type {Map<string, Promise>} */
  pendingRequests = new Map();

  /** * @type {boolean} */
  active;

  /** @type {Date} */
  lastClosedOrdersCheck;
  /** @type {Date} */
  lastOpenOrdersCheck;

  /**
   *
   * @param {import('../types.js').AccountSettings} accountSettings
   */
  constructor(accountSettings) {
    if (this.constructor == ClientBase) {
      throw new Error('Class is abstract type and cannot be instantiated');
    }

    this.apiPublicKey = accountSettings.publicKey;
    this.apiPrivateKey = accountSettings.privateKey;
    this.id = accountSettings.id;
    this.makerFees = accountSettings.makerFees;
    this.takerFees = accountSettings.takerFees;
    this.type = accountSettings.type;
    this.watchBalance = accountSettings.watchBalance;
    this.active = accountSettings.active;
    this.historyStartYear = accountSettings.historyStartYear ?? new Date().getFullYear() - 5;

    this.lastClosedOrdersCheck = new Date(accountSettings.lastClosedOrdersCheck);
    this.lastOpenOrdersCheck = new Date(accountSettings.lastOpenOrdersCheck);

    if (!fs.existsSync(`${App.DataPath}/${this.id}/`)) {
      Terminal.log(`^Created data path for ${this.id}`);
      fs.mkdirSync(`${App.DataPath}/${this.id}`, 0o755);
    }

    fs.readdirSync(`${App.DataPath}/${this.id}/`).forEach((file) => {
      if (file.includes('orders')) {
        this.loadOrders(file.split('.')[0]);
      }
    });

    if (!fs.existsSync(`${App.DataPath}/exchanges/${accountSettings.type}-pairs.json`)) this.requestPairList();
    else this.loadPairList();
  }

  get updateLocalOrders() {
    return this.#updateLocalOrders;
  }

  set updateLocalOrders(value) {
    this.#updateLocalOrders = value;
  }

  /**
   *
   * @param {string} pair
   * @param {Number} price
   */
  setPrice(pair, price) {
    this.prices.set(pair, Number(price));
  }

  /**
   *
   * @param {string} pair
   * @returns {Number}
   */
  getPrice(pair) {
    let price = this.prices.get(pair);
    if (typeof price === 'undefined') {
      let message = `Price for ${pair} not found`;
      Terminal.warning(message);
      return undefined;
    }
    return price;
  }

  /**
   *
   * @param {string} pair
   * @returns {Promise<number>}
   */
  async getPriceAsync(pair) {
    let price = this.getPrice(pair);
    if (price === undefined) {
      await this.requestTickers([pair.toUpperCase()]).then((data) => this.updateTickers(data));
      return this.getPrice(pair);
    } else return price;
  }

  updateTickers(data) {
    for (const entry of data) {
      for (const [key, price] of Object.entries(entry)) {
        Terminal.log(`-> ${key}: ${price}`);
        let pair = key.toLowerCase().replace(/[-]/g, '/');
        pair = PairData.Get(pair);
        this.setPrice(pair, Number(price));
      }
    }
    this.pricePromise = null;
  }

  /**
   *
   * @param {Action} action
   * @returns {Promise<{order: ExchangeOrder, action: Action, result: boolean}> }
   */
  async submitOrder(action) {
    Terminal.error(`Function <${Utils.functionName()}> not implemented`);
    return undefined;
  }

  /**
   *
   * @param {Action} action
   * @returns {Promise<{order: ExchangeOrder, action: string, result: boolean}> }
   */
  async editOrder(action) {
    Terminal.error(`Function <${Utils.functionName()}> not implemented`);
    return undefined;
  }

  /**
   *
   * @returns {Boolean}
   */
  hasKeys() {
    return typeof this.apiPublicKey != 'undefined' || typeof this.apiPrivateKey != 'undefined';
  }

  /**
   *
   * @param {Action} action
   * @returns {Promise<any>}
   */
  async cancelOrder(action) {
    Terminal.error(`Function <${Utils.functionName()}> not implemented`);
  }

  /**
   *
   * @param {string} currency
   * @returns {Number}
   */
  getBalance(currency) {
    if (!this.balances.has(currency)) {
      Terminal.printObject(this.balances);
      Terminal.error(`No balance found for ${currency}`);
      return 0;
    }
    return this.balances.get(currency);
  }

  /**
   *
   * @param {BotSettings} botSettings
   * @returns {String}
   */
  getPairId(botSettings) {
    Terminal.error(`Function <${Utils.functionName()}> not implemented`);
    return undefined;
  }

  /**
   *
   * @param {EcaOrder} plannedOrder
   * @param {ExchangeOrder} exchangeOrder
   * @returns {Promise<{result: boolean, newStatus: string}>}
   */
  async checkPendingOrder(plannedOrder, exchangeOrder = null) {
    Terminal.error(`Function <${Utils.functionName()}> not implemented`);
    return { result: false, newStatus: undefined };
  }

  /**
   *
   * @param {Object} action
   * @returns {Promise<any>}
   */
  async processAction(action) {
    Terminal.error(`Function <${Utils.functionName()}> not implemented`);
  }

  /**
   *
   * @param {string} file
   */
  async loadOrders(file) {
    try {
      var term = Terminal.instance;
      const path = `${App.DataPath}/${this.id}/${file}.json`;
      var data = App.readFileSync(path);
      let version = data['version'];
      if (typeof version === 'undefined' || version !== ExchangeOrder.CurrentVersion)
        term.error(`File: <${path}> has version: ${redBright`${version}`} expected: ${cyanBright`${ExchangeOrder.CurrentVersion}`}`);

      delete data['version'];

      let orderKeys = Object.keys(data);
      orderKeys.forEach((entry) => {
        if (entry == 'version') return;
        var order = new ExchangeOrder(data[entry]);
        this.setExchangeOrder(entry, order);
      });
      term.log(`Loaded ^C${file}^:: ^Y${orderKeys.length.toString()}^: orders found`);
      this.updateLocalOrders = false;
    } catch (e) {
      Terminal.rethrow(e);
      term.error(`[${this.id}]: error while loading ${file}`);
    }
  }

  /**
   * @param {string} id
   * @param {ExchangeOrder} order
   */
  setExchangeOrder(id, order) {
    var term = Terminal.instance;
    if (typeof order === 'undefined' || typeof order.txid === 'undefined') {
      term.printObject(order);
      term.error(`[${id}] invalid order`);
    }

    if (!this.orders.has(id)) {
      if (order.isCancelled && order.volume == 0) {
        term.log(`[${id}] order has been cancelled, discarding`);
        return;
      }
      if (order.isOpen && !order.volume) {
        term.log(`[${id}] invalid open order with volume 0`);
        return;
      }

      this.orders.set(id, order);
      this.updateLocalOrders = true;
    } else {
      let existingOrder = this.getLocalOrder(id);
      if (
        existingOrder.status != order.status ||
        existingOrder.volume != order.volume ||
        existingOrder.price != order.price ||
        existingOrder.fees != order.fees ||
        existingOrder.openDate != order.openDate ||
        existingOrder.closeDate != order.closeDate
      ) {
        this.orders.set(id, order);
        this.updateLocalOrders = true;
      } else {
        term.warning(`Did not update ${id}`);
        term.printObject(order);
      }
    }
  }

  /**
   * @param {string} orderId
   */
  getLocalOrder(orderId) {
    if (!this.hasLocalOrder(orderId)) Terminal.error(`Order ${orderId} not available`);
    else {
      var order = this.orders.get(orderId);
      return order;
    }
  }

  /**
   *
   * @param {string} orderId
   * @returns {boolean}
   */
  hasLocalOrder(orderId) {
    return this.orders.has(orderId);
  }

  /**
   *
   * @param {string} orderId
   * @returns {boolean}
   */
  removeOrder(orderId) {
    return this.orders.delete(orderId);
  }

  /**
   *
   * @param {ExchangeOrder[]} orders
   */
  async verifyOrders(orders) {}

  /**
   *
   * @param {string[]} pairs
   * @returns {Promise<>}
   */
  async requestTickers(pairs) {
    Terminal.error(`Function <${Utils.functionName()}> not implemented`);
  }

  /**
   *
   * @returns {Promise<[string, number][]>}
   */
  async requestBalance() {
    Terminal.error(`Function <${Utils.functionName()}> not implemented`);
    return;
  }

  async requestPairList(saveToFile = true) {
    Terminal.error(`Function <${Utils.functionName()}> not implemented`);
  }

  /**
   *
   * @param {Action[]} actions
   * @returns {Promise<{order: ExchangeOrder, action: string, result: boolean}[]> }
   */
  async executeActions(actions) {
    Terminal.error(`Function <${Utils.functionName()}> not implemented`);
    return undefined;
  }

  /**
   * @param {any} response
   * @returns {ExchangeOrder}
   */
  convertResponseToExchangeOrder(response) {
    return undefined;
  }

  async awaitPrices() {
    if (this.pricePromise) {
      await this.pricePromise;
    }
    return Promise.resolve();
  }

  async awaitBalances() {
    if (this.balancePromise) {
      await this.balancePromise;
    }
    return Promise.resolve();
  }

  /**
   *
   * @param {any} response
   * @returns {String}
   */
  getTxidFromResponse(response) {
    Terminal.error(`Function <${Utils.functionName()}> not implemented`);
    return undefined;
  }

  /**
   *
   * @param {string} txid
   * @returns {Promise<>}
   */
  async queryOrder(txid) {
    Terminal.error(`Function <${Utils.functionName()}> not implemented`);
  }

  /**
   * @param {string} txid
   * @returns {Promise<ExchangeOrder>}
   */
  async requestOrder(txid) {
    Terminal.error(`Function <${Utils.functionName()}> not implemented`);
    return null;
  }

  /**
   * @param {string} txid
   * @returns {Promise<import('ccxt').Order>}
   */
  async requestOrderRaw(txid) {
    Terminal.error(`Function <${Utils.functionName()}> not implemented`);
    return null;
  }

  /**
   *
   * @param {string} pairId
   * @returns {PairData}
   */
  getPairData(pairId) {
    return this.pairs.get(pairId);
  }

  /**
   *
   * @returns {string[]}
   */
  getAvailablePairs() {
    return [...this.pairs.keys()];
  }

  /**
   *
   * @param {string[]} txidArray
   * @returns {Promise<ExchangeOrder[]>}
   */
  async requestOrdersByTxid(txidArray) {
    Terminal.error(`Function <${Utils.functionName()}> not implemented`);
    return null;
  }

  /**
   *
   * @param {string} status
   * @param {any} options
   * @returns {Promise<>}
   */
  async requestOrders(status, options) {
    Terminal.error(`Function <${Utils.functionName()}> not implemented`);
  }

  /**
   *
   * @param {Number} startYear
   * @param {string} status
   */
  async downloadAll(startYear, status) {
    Terminal.error(`Function <${Utils.functionName()}> not implemented`);
  }

  async loadPairList() {
    Terminal.log(`Loading ^C${this.id}^ pair list`);
    var assets = App.readFileSync(`${App.DataPath}/exchanges/${this.type}-pairs.json`);
    for (const [k, v] of Object.entries(assets)) {
      this.pairs.set(k, new PairData(v));
    }
  }

  /**
   *
   * @param {string} status
   * @param {boolean} refresh
   * @returns {Promise<any[]>}
   */
  async requestOrdersByStatus(status, refresh = false) {
    Terminal.error(`Function <${Utils.functionName()}> not implemented`);
    return null;
  }

  /**
   *@param {import('ccxt').Order[]} orders
   */
  updateOrders(orders) {
    Terminal.error(`Function <${Utils.functionName()}> not implemented`);
  }

  // /**
  //    * @param {string} status
  //    * @returns
  //    */
  // async downloadAllOrders(status='closed') {
  //   Terminal.error(`Function <${Utils.functionName()}> not implemented`);
  // }

  /**
   * @param {Number} startYear
   * @returns
   */
  async rebuildHistory(startYear) {
    Terminal.error(`Function <${Utils.functionName()}> not implemented`);
  }

  archiveOrdersByYear(year) {
    var data = {};
    [...this.orders.entries()].forEach(([id, o]) => {
      try {
        var orderYear = new Date(o.openDate).getFullYear();
        if (orderYear === year) {
          data[id] = o;
          Terminal.log(`Added order: ${id}`);
        }
      } catch (ex) {
        Terminal.printObject(o);
        throw ex;
      }
    });
    if (Object.keys(data).length === 0) Terminal.warning(`[${this.id}]: No orders found for ${year}`);
    else {
      this.saveOrdersToFile(`${this.id}-${year}-orders`, data);
    }
  }

  /**
   *
   * @param {string} filter
   * @param {string} valueCurrency
   * @returns {Promise<any[] | any>}
   */
  async requestEarnAllocations(filter, valueCurrency) {
    Terminal.error(`Function <${Utils.functionName()}> not implemented`);
  }

  /**
   *
   * @param {string} id
   * @param {number} amount
   */
  async deallocateFunds(id, amount) {
    Terminal.error(`Function <${Utils.functionName()}> not implemented`);
  }
  /**
   *
   * @param {string} userref
   * @returns {Object}
   */
  findExchangeOrderByRef(userref) {
    Terminal.error(`Function <${Utils.functionName()}> not implemented`);
  }

  /**
   *
   * @param {string} filename
   * @param {any} data
   */
  saveOrdersToFile(filename, data = null) {
    var term = Terminal.instance;
    if (data == null || data.length == 0) {
      term.error(`[${this.id}]: empty order list: saveOrdersToFile`);
    }

    data['version'] = ExchangeOrder.CurrentVersion;

    App.writeFile(`${App.DataPath}/${this.id}/${filename}`, data);
    term.log(`Saved ${Object.keys(data).length - 1} orders`);
  }
}

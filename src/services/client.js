import App from '../app.js';
import Utils from '../utils.js';
import fs from 'fs';
import { cyanBright, greenBright, magentaBright, redBright, yellowBright } from 'ansis';
import BotSettings from '../data/bot-settings.js';
import EcaOrder from '../data/eca-order.js';
import ExchangeOrder from '../data/exchange-order.js';
import Action from '../data/action.js';
import PairData from '../data/pair-data.js';

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

  /**
   * @type {boolean}
   */
  active;

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

    if (!fs.existsSync(`${App.DataPath}/${this.id}/`)) {
      App.log(greenBright`Created data path for ${this.id}`);
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
      App.warning(message);
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
        App.log(`-> ${key}: ${price}`);
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
   * @returns
   */
  async executeAction(action) {
    switch (action.command) {
      case 'submitOrder':
        return this.submitOrder(action);

      case 'editOrder':
        return this.editOrder(action);

      case 'cancelOrder':
        return this.cancelOrder(action);
    }
  }

  /**
   *
   * @param {Action} action
   * @returns {Promise<any>}
   */
  async submitOrder(action) {
    App.error(`Function <${Utils.functionName()}> not implemented`);
  }

  /**
   *
   * @param {Action} action
   * @returns {Promise<any>}
   */
  async editOrder(action) {
    App.error(`Function <${Utils.functionName()}> not implemented`);
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
    App.error(`Function <${Utils.functionName()}> not implemented`);
  }

  /**
   *
   * @param {string} currency
   * @returns {Number}
   */
  getBalance(currency) {
    if (!this.balances.has(currency)) {
      App.printObject(this.balances);
      App.error(`No balance found for ${currency}`);
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
    App.error(`Function <${Utils.functionName()}> not implemented`);
    return undefined;
  }

  /**
   *
   * @param {EcaOrder} plannedOrder
   * @param {ExchangeOrder} exchangeOrder
   * @returns {Promise<{result: boolean, newStatus: string}>}
   */
  async checkPendingOrder(plannedOrder, exchangeOrder = null) {
    App.error(`Function <${Utils.functionName()}> not implemented`);
    return { result: false, newStatus: undefined };
  }

  /**
   *
   * @param {Object} action
   * @returns {Promise<any>}
   */
  async processAction(action) {
    App.error(`Function <${Utils.functionName()}> not implemented`);
  }

  async loadOrders(file) {
    try {
      const path = `${App.DataPath}/${this.id}/${file}.json`;
      var data = App.readFileSync(path);
      let version = data['version'];
      if (typeof version === 'undefined' || version !== ExchangeOrder.CurrentVersion)
        App.error(`File: <${path}> has version: ${redBright`${version}`} expected: ${cyanBright`${ExchangeOrder.CurrentVersion}`}`);

      delete data['version'];

      let orderKeys = Object.keys(data);
      orderKeys.forEach((entry) => {
        if (entry == 'version') return;
        var order = new ExchangeOrder(data[entry]);
        this.setExchangeOrder(entry, order);
      });
      App.log(`Loaded ${yellowBright`${file}`}: ${yellowBright`${orderKeys.length.toString()}`} orders found`);
      this.updateLocalOrders = false;
    } catch (e) {
      App.rethrow(e);
      App.error(`[${this.id}]: error while loading ${file}`);
    }
  }

  /**
   * @param {string} id
   * @param {ExchangeOrder} order
   */
  setExchangeOrder(id, order) {
    if (typeof order === 'undefined' || typeof order.txid === 'undefined') {
      App.printObject(order);
      App.error(`Order [${id}] is not an Exchange Order`);
    }

    if (!this.orders.has(id) || this.orders.get(id).status != order.status) {
      this.orders.set(id, order);
      this.updateLocalOrders = true;
    }
  }

  /**
   *
   * @param {string} orderId
   * @param {boolean} [redownload=false]
   * @returns {Promise<ExchangeOrder>}
   */
  async getExchangeOrder(orderId, redownload = false) {
    if (typeof orderId === 'undefined') App.error(`[${orderId}]: Requested undefined ${this.id} order`);

    let order = this.orders.get(orderId);

    if (redownload || typeof order !== 'object') {
      App.warning(`Requesting [${orderId}]`);
      order = await this.queryOrder(orderId);
      order = this.convertResponseToExchangeOrder(order, orderId);
      this.setExchangeOrder(orderId, order);
    }

    if (typeof order !== 'undefined' && (Array.isArray(order) || typeof order[orderId] !== 'undefined')) {
      App.warning('Object format');
      App.printObject(order);
      order = order[orderId];
    }

    if (typeof order === 'undefined') {
      let errorMsg = `Cannot find ${this.id} order ${orderId}`;
      App.printObject(order);
      App.warning(errorMsg);
      //App.error(errorMsg);
      // App.warning('Waiting...');
      // await new Promise(r => setTimeout(r, 2000));
      // order = await this.queryOrder(orderId);
      // if (typeof order === 'undefined')
      //   App.error('Order still not found');
      // else
      // {App.log('Order found after one attempt');}
      return null;
    } else {
      return order;
    }
  }

  /**
   * @param {string} orderId
   */
  getLocalOrder(orderId) {
    if (!this.hasLocalOrder(orderId)) App.error(`Order ${orderId} not available`);
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
   * @param {string[]} pairs
   * @returns {Promise<>}
   */
  async requestTickers(pairs) {
    App.error(`Function <${Utils.functionName()}> not implemented`);
  }

  /**
   *
   * @returns {Promise<[string, number][]>}
   */
  async requestBalance() {
    App.error(`Function <${Utils.functionName()}> not implemented`);
    return;
  }

  async requestPairList(saveToFile = true) {
    App.error(`Function <${Utils.functionName()}> not implemented`);
  }

  /**
   *
   * @param {Action[]} actions
   * @returns {Promise<ExchangeOrder[]|any>}
   */
  async executeActions(actions) {
    App.error(`Function <${Utils.functionName()}> not implemented`);
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
    App.error(`Function <${Utils.functionName()}> not implemented`);
    return undefined;
  }

  /**
   *
   * @param {string} txid
   * @returns {Promise<>}
   */
  async queryOrder(txid) {
    App.error(`Function <${Utils.functionName()}> not implemented`);
  }

  /**
 *
 * @param {string} txid
   @returns {Promise<ExchangeOrder>}
  */
  async requestOrder(txid) {
    App.error(`Function <${Utils.functionName()}> not implemented`);
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
   * @param {string[]} txidArray
   * @returns {Promise<ExchangeOrder[]>}
   */
  async requestOrdersByTxid(txidArray) {
    App.error(`Function <${Utils.functionName()}> not implemented`);
    return null;
  }

  /**
   *
   * @param {string} status
   * @param {any} options
   * @returns {Promise<>}
   */
  async requestOrders(status, options) {
    App.error(`Function <${Utils.functionName()}> not implemented`);
  }

  /**
   *
   * @param {Number} startYear
   * @param {string} status
   */
  async downloadAll(startYear, status) {
    App.error(`Function <${Utils.functionName()}> not implemented`);
  }

  async loadPairList() {
    App.log(`Loading ${greenBright`${this.id}`} pair list`);
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
    App.error(`Function <${Utils.functionName()}> not implemented`);
    return null;
  }

  /**
   *@param {import('ccxt').Order[]} orders
   */
  updateOrders(orders) {
    App.error(`Function <${Utils.functionName()}> not implemented`);
  }

  // /**
  //    * @param {string} status
  //    * @returns
  //    */
  // async downloadAllOrders(status='closed') {
  //   App.error(`Function <${Utils.functionName()}> not implemented`);
  // }

  /**
   * @param {Number} startYear
   * @returns
   */
  async rebuildHistory(startYear) {
    App.error(`Function <${Utils.functionName()}> not implemented`);
  }

  archiveOrdersByYear(year) {
    var data = {};
    [...this.orders.entries()].forEach(([id, o]) => {
      try {
        var orderYear = new Date(o.openDate).getFullYear();
        if (orderYear === year) {
          data[id] = o;
          App.log(`Added order: ${id}`);
        }
      } catch (ex) {
        App.printObject(o);
        throw ex;
      }
    });
    if (Object.keys(data).length === 0) App.warning(`[${this.id}]: No orders found for ${year}`);
    else {
      this.saveOrdersToFile(`${this.id}-${year}-orders`, data);
    }
  }

  /**
   *
   * @param {EcaOrder} plannedOrder
   * @returns
   */
  async updatePlannedOrder(plannedOrder) {
    var txinfo = await this.getExchangeOrder(plannedOrder.txid, true);

    if (typeof txinfo === 'undefined') {
      App.printObject(plannedOrder);
      App.warning('Invalid response');
    } else {
      switch (plannedOrder.type) {
        case 'limit':
          plannedOrder.status = 'pending';
          plannedOrder.openDate = txinfo.openDate;
          break;

        case 'market':
          plannedOrder.status = 'executed';
          plannedOrder.openDate = txinfo.openDate;
          plannedOrder.closeDate = txinfo.closeDate;
          break;
      }
    }
    return txinfo;
  }

  /**
   *
   * @param {string} filter
   * @param {string} valueCurrency
   * @returns {Promise<any[] | any>}
   */
  async requestEarnAllocations(filter, valueCurrency) {
    App.error(`Function <${Utils.functionName()}> not implemented`);
  }

  /**
   *
   * @param {string} id
   * @param {number} amount
   */
  async deallocateFunds(id, amount) {
    App.error(`Function <${Utils.functionName()}> not implemented`);
  }
  /**
   *
   * @param {string} userref
   * @returns {Object}
   */
  findExchangeOrderByRef(userref) {
    App.error(`Function <${Utils.functionName()}> not implemented`);
  }

  /**
   *
   * @param {string} filename
   * @param {any} data
   */
  saveOrdersToFile(filename, data = null) {
    if (data == null || data.length == 0) {
      App.error(`[${this.id}]: empty order list: saveOrdersToFile`);
    }

    data['version'] = ExchangeOrder.CurrentVersion;

    App.writeFile(`${App.DataPath}/${this.id}/${filename}`, data);
    App.log(`Saved ${Object.keys(data).length - 1} orders`);
  }
}

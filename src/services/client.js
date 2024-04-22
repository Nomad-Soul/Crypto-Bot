import App from '../app.js';
import fs from 'fs';
import { cyanBright, greenBright, yellowBright } from 'ansis';
import BotSettings from '../data/bot-settings.js';
import EcaOrder from '../data/eca-order.js';
import ExchangeOrder from '../data/exchange-order.js';
import Action from '../data/action.js';
import PairData from '../data/pair-data.js';

export default class ClientBase {
  id = 'Abstract Client';
  apiPublicKey;
  apiPrivateKey;
  balances = new Map();
  pairs = new Map();
  type;
  watchBalance;

  /** @type {boolean} */
  #updateLocalOrders;

  /**
   * @type {Map<string, any>}
   */
  orders = new Map();
  /** @type {Map<string, Promise>} */
  pendingRequests = new Map();

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

    if (!fs.existsSync(`${App.DataPath}/${this.id}/`)) {
      App.log(greenBright`Created data path for ${this.id}`);
      fs.mkdirSync(`${App.DataPath}/${this.id}`, 0o755);
    }

    fs.readdirSync(`${App.DataPath}/${this.id}/`).forEach((file) => {
      if (file.includes('orders')) this.loadOrders(file.split('.')[0]);
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
   * @param {Action} action
   * @returns
   */
  async processAction(action) {
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
    App.error('not implemented');
  }

  /**
   *
   * @param {Action} action
   * @returns {Promise<any>}
   */
  async editOrder(action) {
    App.error('not implemented');
  }

  hasKeys() {
    return typeof this.apiPublicKey != 'undefined' || typeof this.apiPrivateKey != 'undefined';
  }

  /**
   *
   * @param {Action} action
   * @returns {Promise<any>}
   */
  async cancelOrder(action) {
    App.error('not implemented');
  }

  /**
   *
   * @param {string} currency
   * @returns {Number}
   */
  getBalance(currency) {
    return this.balances.get(currency);
  }

  /**
   *
   * @param {BotSettings} botSettings
   * @returns {String}
   */
  getPairId(botSettings) {
    App.error('not implemented');
    return undefined;
  }

  /**
   *
   * @param {EcaOrder} plannedOrder
   * @param {ExchangeOrder} exchangeOrder
   * @returns {Promise<{result: boolean, newStatus: string}>}
   */
  async checkPendingOrder(plannedOrder, exchangeOrder = null) {
    App.error('not implemented');
    return { result: false, newStatus: undefined };
  }

  /**
   *
   * @param {Object} action
   * @returns {Promise<any>}
   */
  async processActionSync(action) {
    App.error('not implemented');
  }

  async loadOrders(file) {
    try {
      const path = `${App.DataPath}/${this.id}/${file}.json`;
      var data = await App.readFile(path);

      let orderKeys = Object.keys(data);
      orderKeys.forEach((entry) => this.setExchangeOrder(entry, data[entry]));
      App.log(`Loaded ${yellowBright`${file}`} orders: ${yellowBright`${orderKeys.length.toString()}`} found`);
      this.updateLocalOrders = false;
    } catch (e) {
      App.error(`[${this.id}]: error while loading ${file}`);
    }
  }

  /**
   * @param {string} id
   * @param {ExchangeOrder} order
   */
  setExchangeOrder(id, order) {
    if (!this.orders.has(id) || this.orders.get(id).status != order.status) {
      this.orders.set(id, order);
      this.updateLocalOrders = true;
    }
  }

  /**
   *
   * @param {string} orderId
   * @returns {boolean}
   */
  hasLocalExchangeOrder(orderId) {
    return this.orders.has(orderId);
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

    if (redownload || !order) order = await this.queryOrder(orderId);

    if (typeof order === 'undefined') {
      let errorMsg = `Cannot find ${this.id} order ${orderId}`;
      App.printObject(order);
      App.warning(errorMsg);
      return undefined;
    } else {
      this.setExchangeOrder(orderId, order);
      return this.convertResponseToExchangeOrder(order, orderId);
    }
  }

  /**
   * @param {string} orderId
   */
  getLocalOrder(orderId) {
    if (!this.orders.has(orderId)) App.warning(`Order ${orderId} not available`);
    else return this.convertResponseToExchangeOrder(this.orders.get(orderId), orderId);
  }

  /**
   *
   * @param {string[]} pairs
   */
  async requestTickers(pairs) {
    App.error('not implemented');
  }

  async requestBalance() {
    App.error('not implemented');
  }

  async requestPairList(saveToFile = true) {
    App.error('not implemented');
  }

  /**
   * @param {any} response
   * @param {string} orderId
   * @returns {ExchangeOrder}
   */
  convertResponseToExchangeOrder(response, orderId) {
    return undefined;
  }

  /**
   *
   * @param {any} response
   * @returns {String}
   */
  getTxidFromResponse(response) {
    App.error('not implemented');
    return undefined;
  }

  /**
   *
   * @param {string} txid
   * @returns {Promise<>}
   */
  async queryOrder(txid) {
    App.error('not implemented');
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
   * @returns {Promise<>}
   */
  async downloadOrdersByTxid(txidArray) {
    App.error('not implemented');
  }

  /**
   *
   * @param {string} status
   * @param {any} options
   * @returns {Promise<>}
   */
  async requestOrders(status, options) {
    App.error('not implemented');
  }

  async loadPairList() {
    App.log(greenBright`Loading ${this.id} pair list`);
    var assets = App.readFileSync(`${App.DataPath}/exchanges/${this.type}-pairs.json`);
    this.pairs = new Map(Object.entries(assets));
  }

  async downloadOrders(status) {
    App.error('not implemented');
  }

  /**
   * @param {string} status
   * @returns
   */
  async downloadAllOrders(status) {
    App.error('not implemented');
    return [];
  }

  /**
   *
   * @param {EcaOrder} plannedOrder
   * @returns
   */
  async updatePlannedOrder(plannedOrder) {
    var txinfo = await this.getExchangeOrder(plannedOrder.txid);

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
    App.error('not implemented');
  }

  /**
   *
   * @param {string} id
   * @param {number} amount
   */
  async deallocateFunds(id, amount) {
    App.error('not implemented');
  }
  /**
   *
   * @param {string} userref
   * @returns {Object}
   */
  findExchangeOrderByRef(userref) {
    App.error('not implemented');
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

    App.writeFile(`${App.DataPath}/${this.id}/${filename}`, data);
    App.log(`Saved ${Object.keys(data).length} orders`);
  }
}

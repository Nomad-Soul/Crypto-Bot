import axios from 'axios';
import { redBright, yellowBright, cyanBright, greenBright } from 'ansis';
import WebSocket from 'ws';

import Crypto from 'crypto';
import App from '../app.js';
import ExchangeOrder from '../data/exchange-order.js';
import ClientBase from './client.js';
import PairData from '../data/pair-data.js';
import EcaOrder from '../data/eca-order.js';
import Action from '../data/action.js';
import BotSettings from '../data/bot-settings.js';

export default class KrakenBot extends ClientBase {
  /**
   *
   * @param {AccountSettings} accountSettings
   */
  constructor(accountSettings) {
    super(accountSettings);
  }

  #handleError(e, endPointName, apiEndpointFullURL) {
    App.error(redBright`[${this.id}]: endpoint error ${endPointName}`, false);
    App.printObject(e);
    App.log(apiEndpointFullURL);
    throw e;
  }
  /*
   * Public REST API Endpoints
   */
  async QueryPublicEndpoint(endPointName, inputParameters) {
    const baseDomain = 'https://api.kraken.com';
    const publicPath = '/0/public/';
    const apiEndpointFullURL = baseDomain + publicPath + endPointName + '?' + inputParameters;
    App.warning(apiEndpointFullURL);
    // @ts-ignore
    var jsonData = await axios.get(apiEndpointFullURL).catch((e) => this.#handleError(e, endPointName, apiEndpointFullURL));

    if (typeof jsonData !== 'undefined' && jsonData.data.error.length > 0) {
      App.printObject(jsonData.data);
      App.error(jsonData.data.error);
    }
    return jsonData.data.result;
  }

  /*
   * Private REST API Endpoints
   */

  /**
   *
   * @param {string} endPointName
   * @param {Object} data
   * @returns {Promise<any>}
   */
  async QueryPrivateEndpoint(endPointName, data) {
    if (!this.hasKeys()) {
      let message = `Missing public or private key for ${this.id}!`;
      App.warning(message);
      return null;
    }

    if (typeof endPointName === 'undefined') App.error('Undefined endpoint');

    const baseDomain = 'https://api.kraken.com';
    const privatePath = '/0/private/';

    const apiEndpointFullURL = baseDomain + privatePath + endPointName;
    const nonce = Date.now().toString();
    data['nonce'] = nonce;
    //const apiPostBodyData = "nonce=" + nonce + "&" + inputParameters;
    let apiPostBodyData = new URLSearchParams(data);

    const signature = this.CreateAuthenticationSignature(privatePath, endPointName, nonce, apiPostBodyData);

    const httpOptions = {
      headers: {
        'API-Key': this.apiPublicKey,
        'API-Sign': signature,
      },
    };

    // @ts-ignore
    let jsonData = await axios.post(apiEndpointFullURL, apiPostBodyData, httpOptions).catch((e) => this.#handleError(e, endPointName, apiEndpointFullURL));

    if (typeof jsonData !== 'undefined' && jsonData.data.error.length > 0) {
      App.error(redBright`[${this.id}]: api endpoint error ${endPointName}`, false);
      App.log(jsonData.data.error, false, redBright);
      App.log(apiEndpointFullURL);
      App.printObject(data, false);
      await App.rethrow(new Error(jsonData.data.error, { cause: 'ExchangeAPI' }));
    } else return jsonData.data.result;
  }

  CreateAuthenticationSignature(apiPath, endPointName, nonce, apiPostBodyData) {
    const apiPost = nonce + apiPostBodyData;
    const secret = Buffer.from(this.apiPrivateKey, 'base64');
    const sha256 = Crypto.createHash('sha256');
    const hash256 = sha256.update(apiPost).digest('binary');
    const hmac512 = Crypto.createHmac('sha512', secret);
    const signatureString = hmac512.update(apiPath + endPointName + hash256, 'binary').digest('base64');
    return signatureString;
  }

  async OpenAndStreamWebSocketSubscription(connectionURL, webSocketSubscription) {
    try {
      const webSocketClient = new WebSocket(connectionURL);

      webSocketClient.on('open', function open() {
        webSocketClient.send(webSocketSubscription);
      });

      webSocketClient.on('message', function incoming(wsMsg) {
        var d = new Date();
        var msgTime = d.getHours() + ':' + d.getMinutes() + ':' + d.getSeconds();
        console.log(msgTime + ': ' + wsMsg);
      });

      webSocketClient.on('close', function close() {
        console.log('|==============================================|');
        console.log('|     END OF PROGRAM - HAVE A GOOD DAY :)      |');
        console.log('|==============================================|');
        console.log('\n');
      });
    } catch (e) {
      console.log();
      console.log('AN EXCEPTION OCCURED :(');
      console.log(e);
    }
  }

  /**
   *
   * @param {any} data
   * @returns {Promise<>}
   */
  async queryPublic(data) {
    let publicResponse;
    let publicEndpoint = data['endpoint'];
    let publicInputParameters = '';

    publicInputParameters = Object.entries(data)
      .filter(([key, value]) => key != 'endpoint')
      .map((kv) => kv.map(encodeURIComponent).join('='))
      .join('&');

    publicResponse = await this.QueryPublicEndpoint(publicEndpoint, publicInputParameters);
    return publicResponse;
  }

  async queryPrivate(data, test = false, sendAsJSON = false) {
    let endpoint = data['endpoint'];
    delete data['endpoint'];

    if (!test) {
      return this.QueryPrivateEndpoint(endpoint, data);
    } else {
      App.log(`${endpoint}/${new URLSearchParams(data).toString()}`, true);
      return { descr: { order: 'test' }, txid: ['XXXXXX-YYYYYY-ZZZZZZ'] };
    }
  }

  /**
   *
   * @param {Action} action
   * @returns
   */
  async submitOrder(action) {
    App.log(`[${action.id}]: submitting ${yellowBright`${action.type} order ${action.direction} at ${action.price} on ${action.account}`}`);
    return this.queryPrivate(KrakenBot.ActionToKrakenOrder(action), action.isTest);
  }

  /**
   *
   * @param {Action} action
   * @returns
   */
  async editOrder(action) {
    App.log(`${greenBright`[${action.id}]: editing`} ${yellowBright`${action.txid}`} on ${action.account}`);
    App.log(`Edited price: ${action.price} volume: ${action.volume}`);
    return this.queryPrivate({ endpoint: 'EditOrder', txid: action.txid, pair: action.pair, price: action.price, volume: action.volume });
  }

  /**
   *
   * @param {Action} action
   * @returns
   */
  async cancelOrder(action) {
    App.log(`${greenBright`[${action.id}]: cancelling`} ${yellowBright`${action.txid}`} on ${action.account}`);
    return this.queryPrivate({ endpoint: 'CancelOrder', txid: action.txid }, action.isTest);
  }

  /**
   *
   * @param {*} action
   */
  async processActionSync(action) {
    var response = await this.processAction(action);
    if (typeof response.error != 'undefined') {
      App.log(redBright`Response follows:`, true);
      App.printObject(response.error);
      return response;
    } else {
      App.log(greenBright`Response follows:`, true);
      App.printObject(response);
    }
    App.log(yellowBright`----- end -----`);
    return response;
  }

  async queryOrder(txid) {
    var data = {
      endpoint: 'QueryOrders',
      txid: txid,
    };
    if (this.pendingRequests.has(txid)) return this.pendingRequests.get(txid);

    App.log(greenBright`Downloading ${this.id} order ${yellowBright`${txid}`}`, true);
    var promise = this.queryPrivate(data, false, true).then((response) => {
      try {
        var order = Object.values(response)[0];
        order.txid = txid;
        return order;
      } catch (e) {
        App.warning(`${this.id}/QueryPrivate response:`);
        App.printObject(response, false);
        App.error(e);
      }
    });

    this.pendingRequests.set(txid, promise);
    promise.finally(() => this.pendingRequests.delete(txid));
    return promise;
  }

  /**
   * @param {string[]} txidArray
   */
  async downloadOrdersByTxid(txidArray) {
    var txidString = txidArray.join(',');
    var data = {
      endpoint: 'QueryOrders',
      txid: txidString,
    };
    if (this.pendingRequests.has(txidString)) return this.pendingRequests.get(txidString);

    App.log(greenBright`Downloading ${this.id} orders ${yellowBright`${txidArray.join(', ')}`}`, true);
    var promise = this.queryPrivate(data, false, true).then((response) => {
      try {
        Object.entries(response).forEach(([txid, order]) => {
          order.txid = txid;
          this.setExchangeOrder(txid, order);
        });
        return true;
      } catch (e) {
        App.warning(`${this.id}/QueryPrivate response:`);
        App.printObject(response, false);
        App.error(e);
      }
    });
    this.pendingRequests.set(txidString, promise);
    promise.finally(() => this.pendingRequests.delete(txidString));
    return promise;
  }

  /**
   * @param {string} status
   * @param {any} options
   */
  async requestOrders(status, options = undefined) {
    const { pagination } = options || { pagination: 0 };
    var endpoint = '';
    switch (status) {
      case 'closed':
        endpoint = 'Closed';
        break;

      case 'open':
        endpoint = 'Open';
        break;
    }
    var data = {
      endpoint: `${endpoint}Orders`,
    };

    if (pagination > 0) data.ofs = pagination;

    return this.queryPrivate(data);
  }

  async requestPairList() {
    App.log(greenBright`Requesting pair list for ${this.id}`);
    var data = { endpoint: 'AssetPairs' };
    return this.queryPublic(data).then((response) => {
      Object.entries(response).forEach(([key, pairData]) => {
        let cryptoAlias = PairData.GetAliasCurrency(pairData.base);
        let currencyAlias = PairData.GetAliasCurrency(pairData.quote);
        let pair = `${cryptoAlias}/${currencyAlias}`;
        this.pairs.set(pair, KrakenBot.ConvertKrakenPairData(pairData));
      });
      App.writeFile(`${App.DataPath}/exchanges/${this.type}-pairs`, Object.fromEntries([...this.pairs.entries()]));
    });
  }

  async loadPairList() {
    App.log(greenBright`Loading ${this.id} pair list`);
    var assets = App.readFileSync(`${App.DataPath}/exchanges/${this.type}-pairs.json`);
    this.pairs = new Map(Object.entries(assets));
  }

  /**
   * @param {string} status
   */
  async downloadOrders(status) {
    App.log(`${cyanBright`Downloading`} ${this.id} ${status} orders`);
    return this.requestOrders(status).then(
      (response) =>
        new Promise((resolve, reject) => {
          if (response == null) resolve(false);
          if (this.updateOrders(response.closed ?? response.open, status)) resolve(true);
          else reject(false);
        }),
    );
  }

  /**
   * @param {string} status
   * @returns
   */
  async downloadAllOrders(status) {
    App.warning(`Downloading all ${status} orders from ${this.id}`);
    var orderCount = 0;

    return this.requestOrders(status).then((response) => {
      var promises = [];
      promises.push(new Promise((resolve, reject) => (this.updateOrders(response.closed, status, true) ? resolve(true) : reject(false))));
      orderCount = response.count - Object.keys(response.closed).length;
      App.warning(`Total orders: ${response.count}, ${response.count - this.orders.size} missing from ${this.id}`);
      let requests = Math.ceil(orderCount / 50);
      for (let i = 1; i <= requests; i++) {
        App.warning(`Submitting request ${yellowBright`${i.toString()}`} to ${this.id}`);

        promises.push(
          this.requestOrders(status, { pagination: 50 * i }).then(
            (response) => new Promise((resolve, reject) => (this.updateOrders(response.closed, status, true) ? resolve(true) : reject(false))),
          ),
        );
      }
      return Promise.all(promises);
    });
  }

  archiveOrdersByYear(year) {
    var data = {};
    [...this.orders.entries()].forEach(([id, o]) => {
      if (new Date(o.openDate.getTime() * 1000).getFullYear() === year) data[id] = o;
    });
    if (data.length === 0) App.warning(`[${this.id}]: No orders found for ${year}`);
    this.saveOrdersToFile(`${this.id}-${year}-orders`, data);
  }

  async requestBalance() {
    App.log(greenBright`Requesting balance from ${this.id}`);
    var data = {
      endpoint: 'Balance',
    };
    var promise = this.queryPrivate(data);
    promise.then((response) => {
      if (response == null) return;
      for (const [key, value] of Object.entries(response)) {
        this.balances.set(PairData.GetAliasCurrency(key), Number(value));
      }
      return this.balances;
    });
    return promise;
  }

  /**
   *
   * @param {string[]} pairs
   * @returns {Promise<>}
   */
  async requestTickers(pairs) {
    App.log(greenBright`Updating prices from ${this.id}`);
    var data = { endpoint: 'Ticker', pair: pairs.join(',') };
    var tickers = {};
    return this.queryPublic(data)
      .then((response) => {
        for (const [key, ticker] of Object.entries(response)) {
          let last = Number(ticker.c[0]);
          let pair = key.toLowerCase();
          tickers[pair] = last;
        }
      })
      .then(() => tickers);
  }

  async requestEarnStrategies(asset) {
    var data = { endpoint: 'Earn/Strategies' };
    if (typeof asset !== 'undefined') data.asset = asset;
    var response = await this.queryPrivate(data, false, false);
    if (typeof response.items !== 'undefined') {
      App.log(`Received earn strategies for [${this.id}]`);
      console.log(response.items);
    }
  }

  /**
   *
   * @param {string} filter
   * @param {string} valueCurrency
   * @returns {Promise<any[] | any>}
   */
  async requestEarnAllocations(filter, valueCurrency) {
    var data = { endpoint: 'Earn/Allocations', converted_asset: valueCurrency.toUpperCase(), hide_zero_allocations: true };
    var response = await this.queryPrivate(data, false, false);
    if (typeof response.items !== 'undefined') {
      App.log(`Received earn allocations for [${this.id}]`);
      if (typeof filter !== 'undefined') {
        var filtered = response.items.filter((item) => item.native_asset.toLowerCase() === filter);
        return filtered.map((item) => {
          return { asset: item.native_asset, strategyId: item.strategy_id, amount: item.amount_allocated.total.native };
        });
      } else return response;
    } else return { status: 'failed' };
  }

  /**
   *
   * @param {string} id
   * @param {number} amount
   */
  async deallocateFunds(id, amount) {
    App.warning(`Requesting deallocation for ${id} of ${amount}`);
    var data = { endpoint: 'Earn/Deallocate', strategy_id: id, amount: amount };
    var response = await this.queryPrivate(data, false, false);
    if (response) App.warning('Deallocation submitted');
    else {
      App.warning('Deallocation failed');
      App.printObject(response);
    }
  }

  /**
   *
   * @param {any[]} orders
   * @param {string} status
   * @returns {boolean}
   */
  updateOrders(orders, status, overrideSave = false) {
    if (typeof orders === 'undefined') {
      App.warning(`No ${this.id} ${status} orders received`);
      return false;
    }
    let statusOrders = Object.entries(orders);
    App.log(`Received ${cyanBright`${statusOrders.length.toString()}`} ${status} orders from ${this.id} [${statusOrders.length.toString()}] total`);

    statusOrders.forEach(([key, order]) => this.setExchangeOrder(key, order));

    return true;
  }

  /**
   *
   * @param {string} userref
   * @returns {Object}
   */
  findExchangeOrderByRef(userref) {
    try {
      return [...this.orders.values()].find((order) => order.userref === userref);
    } catch (error) {
      App.log(`Cannot find order for ${userref}`, true);
    }
  }

  /**
   *
   * @param {any} response
   * @param {string} orderId
   * @returns
   */
  convertResponseToExchangeOrder(response, orderId) {
    var exchangeOrder = KrakenBot.ConvertToExchangeOrder(response);
    if (typeof exchangeOrder.txid === 'undefined' && orderId !== 'undefined') exchangeOrder.txid = orderId;
    return exchangeOrder;
  }

  /**
   *
   * @param {any} response
   * @returns {string}
   */
  getTxidFromResponse(response) {
    // if response is from edit order
    if (typeof response.originaltxid !== 'undefined') return response.txid;
    // else response is from add order
    else return response.txid[0];
  }

  /**
   *
   * @param {EcaOrder} plannedOrder
   * @param {ExchangeOrder} exchangeOrder
   * @returns {Promise<{result: boolean, newStatus: string}>}
   */
  async checkPendingOrder(plannedOrder, exchangeOrder = null) {
    if (exchangeOrder == null) exchangeOrder = await this.getExchangeOrder(plannedOrder.txid);
    var result = false;
    var newStatus = 'none';
    if (exchangeOrder.status === 'closed') {
      plannedOrder.status = 'executed';
      plannedOrder.closeDate = exchangeOrder.closeDate;
      plannedOrder.volumeQuote = exchangeOrder.cost;
      result = true;
      newStatus = plannedOrder.status;
    } else if (exchangeOrder.status === 'cancelled') {
      plannedOrder.status = 'cancelled';
      plannedOrder.closeDate = exchangeOrder.closeDate;
      result = true;
      newStatus = plannedOrder.status;
    } else result = false;

    return new Promise((resolve) => resolve({ result: result, newStatus: newStatus }));
  }

  /**
   * @param {BotSettings} botSettings
   */
  getPairId(botSettings) {
    return `${botSettings.base}${botSettings.quote}`.toLowerCase();
  }

  /**
   * @param {{ pair: string; interval?: number; since?: number}} data
   */
  async requestCandleData(data) {
    // @ts-ignore
    data.endpoint = 'OHLC';
    return this.queryPublic(data).then((response) => {
      var candles = response[data.pair.toUpperCase()].map((candle) => {
        return { x: candle[0] * 1000, o: candle[1], h: candle[2], l: candle[3], c: candle[4], vwap: candle[5], vol: candle[6] };
      });
      return candles;
    });
  }

  /**
   * @param {Action} action
   */
  static ActionToKrakenOrder(action) {
    action.performChecks();

    var data = {
      userref: action.userref,
      pair: action.pair,
      type: action.direction,
      ordertype: action.type,
      volume: action.volume,
    };

    switch (action.command) {
      case 'submitOrder':
        data.endpoint = 'AddOrder';
        break;

      default:
        App.log(`Unknown command ${action.command}`);
    }

    if (action.type === 'limit') {
      data.price = action.price;
    }

    // Kraken API required fields check

    return data;
  }

  static ConvertToExchangeOrder(txinfo) {
    try {
      var type = txinfo.descr.ordertype;
    } catch (e) {
      App.printObject(txinfo);
      App.rethrow(e);
    }
    return new ExchangeOrder({
      type: txinfo.descr.ordertype,
      status: KrakenBot.ConvertKrakenStatusToExchangeOrder(txinfo.status),
      side: txinfo.descr.type,
      openDate: new Date(txinfo.opentm * 1000),
      closeDate: txinfo.status === 'open' ? undefined : new Date(txinfo.closetm * 1000),
      volume: Number(type === 'market' ? txinfo.vol_exec : txinfo.vol),
      price: Number(txinfo.price) === 0 ? Number(txinfo.descr.price) : Number(txinfo.price),
      cost: Number(type === 'market' ? txinfo.cost : txinfo.descr.price * txinfo.vol),
      fees: Number(txinfo.fee),
      userref: txinfo.userref,
      pair: PairData.Get(txinfo.descr.pair.toLowerCase()),
    });
  }

  /**
   *
   * @param {any} pair
   * @returns {PairData}
   */
  static ConvertKrakenPairData(pair) {
    try {
      var base = PairData.GetAliasCurrency(pair.base);
      var quote = PairData.GetAliasCurrency(pair.quote);
      return new PairData({
        id: `${base}/${quote}`,
        base: base,
        quote: quote,
        nativeBaseId: pair.base,
        nativeQuoteId: pair.quote,
        minVolume: Number(pair.ordermin),
        maxBaseDigits: pair.lot_decimals,
        maxQuoteDigits: pair.pair_decimals,
        minBaseDisplayDigits: pair.ordermin.toString().split('.')[1]?.length || 0,
      });
    } catch (e) {
      App.printObject(pair);
      App.rethrow(e);
    }
  }

  static ConvertKrakenStatusToExchangeOrder(status) {
    switch (status) {
      case 'canceled':
        // We use British English but Kraken uses AE
        return 'cancelled';
      default:
        return status;
    }
  }
}

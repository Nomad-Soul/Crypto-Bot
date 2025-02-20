import { redBright, yellowBright, cyanBright, greenBright, magentaBright } from 'ansis';
import ClientBase from './client.js';
import ccxt, { Exchange, kraken, coinbase } from 'ccxt';
import fs from 'fs';
import App from '../app.js';
import PairData from '../data/pair-data.js';
import KrakenBot from './kraken.js';
import Action from '../data/action.js';
import ExchangeOrder from '../data/exchange-order.js';
import EcaOrder from '../data/eca-order.js';
import BotSettings from '../data/bot-settings.js';

export default class ExchangeClient extends ClientBase {
  /** @type {Exchange} */
  #ccxtClient;
  /**
   * @param {import('../types.js').AccountSettings} accountSettings
   */
  constructor(accountSettings) {
    super(accountSettings);
    this.#ccxtClient = new ccxt[accountSettings.type]({
      apiKey: accountSettings.publicKey,
      secret: accountSettings.privateKey,
    });

    let thisYear = new Date().getFullYear();
    let startYear = this.historyStartYear;
    let rebuildHistory = false;
    for (let i = startYear; i <= thisYear; i++) {
      let filename = `${App.DataPath}/${this.id}/${this.id}-${i}-orders.json`;
      if (!fs.existsSync(filename)) {
        App.warning(`File ${filename} not found`);
        rebuildHistory = true;
        break;
      } else startYear++;
    }
    if (rebuildHistory) this.rebuildHistory(startYear);
    //this.testFee();
    // if (this.id == 'coinbase')
    // this.requestOrder('5888f8f1-81e7-473d-8a36-5f1dfdc57499').then(data => App.printObject(data));
    //this.#krakenClient = new KrakenBot(accountSettings);
    // this.requestTickers(['btc/eur'.toUpperCase()]).then((response) => console.log(response));
    // this.requestBalance().then((r) => console.log(r));
    //this.requestOrder('OJVWDS-RYFDV-R2FDGF').then((r) => console.log(r));
    //this.requestOrder('85b2452f-e584-4cd2-b328-a70e6caf7e7b').then((r) => console.log(r));
  }

  async test() {
    await this.#ccxtClient.loadMarkets();

    //var orders = await this.#ccxtClient.fetchClosedOrders(undefined, undefined, 100);
    var orderId = 'a Kraken order id';

    var now = Date.now();
    var order = await this.#ccxtClient.fetchOrder(orderId);
    //var order = orders.find((o) => o.id === orderId);
    console.log(order);
    var elapsed = Date.now() - now;
    App.warning(`Took: ${elapsed} ms`);
  }

  async testFee() {
    this.requestPairList();
    // var markets = await this.#ccxtClient.loadMarkets();
    // var btc = markets['BTC/EUR'];
    // App.printObject(markets['BTC/EUR'].base);
    // App.error();
    // var currency = this.#ccxtClient.currencies['XETH'];
    // App.printObject(currency);
    // //this.#ccxtClient.fetchTradingFees().then((r) => App.printObject(r));
    // this.#ccxtClient.fetchTradingFee('ETH/EUR').then((r) => App.printObject(r));
    // //this.#ccxtClient.fetchDepositWithdrawFee('ETH').then((r) => App.printObject(r));
    // //App.log(`[${cyanBright`${this.type}`}] ETH: ${currency.fee} / ${currency.withdraw}`);
  }

  /**
   * @param {{ since: number; pair: string; }} options
   */
  async requestOHLC(options) {
    console.log(options.since);
    return this.#ccxtClient
      .fetchOHLCV(options.pair.toUpperCase(), '1d', options.since)
      .then((response) => response.map((candle) => ({ x: candle[0], o: candle[1], h: candle[2], l: candle[3], c: candle[4], vol: candle[5] })));
  }

  /**
   *
   * @param {Action} action
   * @returns
   */
  async submitOrder(action) {
    var order = action.plannedOrder.order;
    App.log(
      `${greenBright`[${action.plannedOrder.id}]: submitting`} ${yellowBright`${order.type} order ${order.side} at ${order.price.toFixed(2)} on ${action.plannedOrder.account}`}`,
    );
    var promise = this.#ccxtClient
      .createOrder(order.pair.toUpperCase(), order.type, order.side, order.volume, order.price, {
        clientOrderId: action.plannedOrder.order.userref,
      })
      .then((order) => {
        let exOrder = ExchangeClient.ConvertCcxtOrderToExchangeOrder(order, this);
        if (order.id) {
          this.setExchangeOrder(exOrder.txid, exOrder);
          return { order: exOrder, result: true };
        } else return { order: exOrder, result: false };
      });
    if (action.postExecutionCallback) {
      return promise.then((response) => action.postExecutionCallback(response));
    } else return promise;
  }

  async cancelOrder(action) {
    var order = action.order;
    App.log(`${greenBright`[${order.id}]: cancelling`} order on ${action.account}`);
    return this.#ccxtClient.cancelOrder(order.txid);
  }

  /**
   *
   * @param {Action} action
   * @returns
   */
  async editOrder(action) {
    var order = action.plannedOrder.order;
    App.log(`${greenBright`[${order.txid}]: editing`} order on ${action.plannedOrder.account}`);
    App.log(`Edited price: ${order.price} volume: ${order.volume}`);
    var promise = this.#ccxtClient.editOrder(order.txid, order.pair.toUpperCase(), order.type, order.side, order.volume, order.price).then((order) => {
      if (order.id) {
        let exOrder = ExchangeClient.ConvertCcxtOrderToExchangeOrder(order, this);
        this.setExchangeOrder(exOrder.txid, exOrder);
        return { order: exOrder, result: true };
      } else {
        return { order: action.plannedOrder.order, result: false };
      }
    });
    if (action.postExecutionCallback) {
      return promise.then((response) => action.postExecutionCallback(response));
    } else return promise;
  }

  async requestPairList(saveToFile = true) {
    App.log(greenBright`Requesting pair list for ${this.id}`);

    return this.#ccxtClient
      .loadMarkets()
      .then((response) =>
        [...Object.entries(response)]
          .map(([key, pair]) => ExchangeClient.ConvertPairData(pair, this.#ccxtClient.precisionMode))
          .filter((pair) => pair.quote.toLowerCase() === App.locale.currency),
      )
      .then((data) => {
        if (!saveToFile) return;
        var dataEntries = { _exchange: this.type, _createdOn: new Date().toISOString() };
        data.forEach((pairData) => (dataEntries[pairData.id] = pairData));
        App.warning(`D: ${data.length} C:${App.locale.currency}`);
        App.writeFile(`${App.DataPath}/exchanges/${this.type}-pairs`, dataEntries);
      });
  }

  /**
   *
   * @param {string} txid
   * @returns {Promise<ExchangeOrder>}
   */
  async requestOrder(txid) {
    App.log(`Downloading order <${yellowBright`${txid}`}>`);
    return this.#ccxtClient.fetchOrder(txid).then((order) => {
      let exOrder = ExchangeClient.ConvertCcxtOrderToExchangeOrder(order, this);
      this.setExchangeOrder(exOrder.txid, exOrder);
      return exOrder;
    });
  }

  /**
   * @param {Number} startYear
   * @returns
   */
  async rebuildHistory(startYear) {
    App.log(`Rebuilding history for account ${magentaBright`${this.id}`}: ${startYear}-${new Date().getFullYear()}`);
    return this.downloadAll(startYear).then((orders) => {
      orders.forEach((order) => this.setExchangeOrder(order.txid, order));
      for (let i = startYear; i <= new Date().getFullYear(); i++) {
        this.archiveOrdersByYear(i);
      }
    });
  }

  /**
   *
   * @param {Number} startYear
   * @param {string} status
   * @returns
   */
  async downloadAll(startYear = 2021, status = 'closed') {
    const limit = 50;
    var since = new Date(startYear, 0, 1).getTime();
    var end = new Date(startYear, 11, 31, 23, 59, 59, 999).getTime();
    var orders = [];
    var lastOrder = {};
    while (since < this.#ccxtClient.milliseconds()) {
      App.log(
        `Requesting orders from ${cyanBright`${this.id}`}: ${yellowBright`${new Date(since).toDateString()}`} to ${yellowBright`${new Date(end).toDateString()}`}`,
      );
      const responseOrders = await this.#fetchClosedOrders(undefined, limit, since, end);
      if (responseOrders.length && responseOrders[0]['id'] !== lastOrder['id']) {
        orders = orders.concat(responseOrders);
        App.log(`Waiting for new order request... [${yellowBright`${responseOrders.length.toString()} / ${orders.length.toString()}`}]`);
        lastOrder = responseOrders[0];
        end = lastOrder['timestamp'] - 1;
        App.log(new Date(end).toDateString());
        App.log(new Date(responseOrders.at(-1)['timestamp']));
      } else {
        since = new Date(++startYear, 0, 1).getTime();
        end = new Date(startYear, 11, 31, 23, 59, 59, 999).getTime();
      }
    }
    return orders.map((order) => ExchangeClient.ConvertCcxtOrderToExchangeOrder(order, this)).filter((order) => order.isClosed);
  }

  async #fetchClosedOrders(symbol, limit, start, end) {
    switch (this.type) {
      case 'kraken':
        return this.#ccxtClient.fetchClosedOrders(symbol, start, limit, { end: end / 1000 });

      case 'coinbase':
      default:
        return this.#ccxtClient.fetchClosedOrders(symbol, start, limit, { until: end });
    }
  }

  /**
   * @param {any} response
   * @returns {ExchangeOrder}
   */
  convertResponseToExchangeOrder(response) {
    return ExchangeClient.ConvertCcxtOrderToExchangeOrder(response, this);
  }

  /**
   *
   * @param {string} status
   * @param {boolean} refresh
   * @returns {Promise<any[]>}
   */
  async requestOrdersByStatus(status, refresh = false) {
    var orders = [];
    var since = new Date(new Date().getFullYear(), 0, 1);

    for (let [txid, order] of this.orders) {
      if (order.openDate > since) since = order.openDate;
    }

    if (refresh) {
      App.log(`Requesting ${cyanBright`${status}`} orders from ${cyanBright`${this.id}`} starting from ${yellowBright`${App.toDateTime(since)}`}`);
      var supported = true;
      switch (status) {
        case 'open':
          if (this.#ccxtClient.has['fetchOpenOrders']) orders = await this.#ccxtClient.fetchOpenOrders(undefined, since.getTime());
          else supported = false;
          break;

        case 'closed':
          if (this.#ccxtClient.has['fetchClosedOrders']) {
            orders = await this.#ccxtClient.fetchClosedOrders(undefined, since.getTime());
          } else supported = false;
          break;

        case 'cancelled':
          if (this.#ccxtClient.has['fetchCanceledAndClosedOrders']) orders = await this.#ccxtClient.fetchCanceledAndClosedOrders(undefined, since.getTime());
          else supported = false;
          break;
      }

      if (!supported) {
        if (this.#ccxtClient.has['fetchOrders'])
          orders = await this.#ccxtClient.fetchOrders(undefined, since.getTime()).then((orders) => orders.filter((o) => o.status === 'status'));
        else throw new Error(`${this.#ccxtClient.id} does not support any method to download orders by status`);
      }

      App.log(`Received ${cyanBright`${orders.length.toString()}`} ${status} orders from ${this.type}:${this.id}`);
      orders = orders.map((order) => ExchangeClient.ConvertCcxtOrderToExchangeOrder(order, this));
      orders.forEach((order) => this.setExchangeOrder(order.txid, order));
    } else orders = [...this.orders.values()].filter((o) => o.status === 'status');
    return orders;
  }

  /**
   * @param {BotSettings} botSettings
   * @returns {String}
   */
  getPairId(botSettings) {
    return `${botSettings.base}/${botSettings.quote}`.toLowerCase();
  }

  /**
   *
   * @param {import('ccxt').Order[]} orders
   */
  updateOrders(orders) {
    for (const order of orders) {
      this.setExchangeOrder(order.id, ExchangeClient.ConvertCcxtOrderToExchangeOrder(order, this));
    }
  }

  /**
   *
   * @param {string[]} pairs
   * @returns {Promise<>}
   */
  async requestTickers(pairs) {
    App.log(`Updating prices for account ${greenBright`${this.id}`}`);
    this.pricePromise = this.#ccxtClient.fetchTickers(pairs).then((data) => Object.entries(data).map(([key, ticker]) => ({ [key]: ticker.last })));

    return this.pricePromise;
  }

  /**
   *
   * @returns {Promise<[string, number][]>}
   */
  async requestBalance() {
    App.log(`Requesting balance from ${greenBright`${this.id}`}`);
    this.balancePromise = this.#ccxtClient
      .fetchBalance()
      .then((balances) => Object.entries(balances.total).forEach((balance) => this.balances.set(balance[0].toLowerCase(), balance[1])))
      .then(() => (this.balancePromise = null));

    return this.balancePromise;
  }

  /**
   *
   * @param {string[]} txidArray
   * @returns {Promise<ExchangeOrder[]>}
   */
  async requestOrdersByTxid(txidArray) {
    App.log(greenBright`Downloading ${this.id} orders ${yellowBright`${txidArray.join(', ')}`}`, true);
    var promise;

    if (this.#ccxtClient.id === 'kraken') {
      /** @type {kraken} */
      // @ts-ignore
      var krakenClient = this.#ccxtClient;
      promise = krakenClient.fetchOrdersByIds(txidArray).then((orders) =>
        orders.map((order) => {
          var exOrder = ExchangeClient.ConvertCcxtOrderToExchangeOrder(order, this);
          this.setExchangeOrder(order.id, exOrder);
          return exOrder;
        }),
      );
    } else {
      promise = Promise.all(txidArray.map((txid) => this.requestOrder(txid)));
    }
    return promise;
  }

  /**
   *
   * @param {Action[]} actions
   * @returns {Promise<ExchangeOrder[]|any>}
   */
  async executeActions(actions) {
    if (actions.length == 0) return 'Nothing to do';
    var responses = [];
    for (let i = 0; i < actions.length; i++) {
      let action = actions[i];
      App.log(`${[action.plannedOrder.id]}: ${action.command}`);

      switch (action.command) {
        case 'submitOrder':
          responses.push(await this.submitOrder(action));

          break;
        case 'editOrder':
          responses.push(await this.editOrder(action));
          break;

        case 'cancelOrder':
          //responses.push(await this.processAction(action));
          break;

        default:
          App.printObject(action);
          App.error(`Unknown action: ${action.command}`);
          break;
      }
    }
    return responses;
  }

  /**
   * @param {import('ccxt').Market} marketData
   * @returns {PairData}
   * @param {number} precisionMode
   */
  static ConvertPairData(marketData, precisionMode) {
    return new PairData({
      id: `${marketData.base}/${marketData.quote}`.toLocaleLowerCase(),
      base: marketData.base.toLowerCase(),
      quote: marketData.quote.toLowerCase(),
      nativeBaseId: marketData.baseId,
      nativeQuoteId: marketData.quoteId,
      minVolume: marketData.limits.amount.min,
      maxBaseDigits: ExchangeClient.ConvertPrecision(precisionMode, marketData.precision.amount),
      maxQuoteDigits: ExchangeClient.ConvertPrecision(precisionMode, marketData.precision.price),
      minBaseDisplayDigits: ExchangeClient.ConvertPrecision(precisionMode, marketData.limits.amount.min),
      makerFees: marketData.maker,
      takerFees: marketData.taker,
      precision: marketData.precision,
    });
  }

  /**
   * @param {import('ccxt').Order} order
   * @param {ClientBase} client
   * @returns {ExchangeOrder}
   */
  static ConvertCcxtOrderToExchangeOrder(order, client) {
    var closeDate = undefined;
    var openDate = new Date(order.timestamp);
    var status = order.status ?? 'open';
    var volume = order.remaining;
    var cost = order.cost;
    var fees = order.fee?.cost ?? 0;
    // ccxt currently lacks a property for the close time (or is undefined)
    try {
      if (status === 'closed' || (status === 'canceled' && order.filled > 0)) {
        volume = order.filled;
        switch (client.type) {
          case 'kraken':
            closeDate = new Date(order.info.closetm * 1000);
            if (status === 'canceled') status = 'closed';
            break;

          case 'coinbase':
            closeDate = new Date(order.info.last_fill_time);
            break;
        }
      } else if (status === 'canceled' && order.filled == 0) {
        status = 'cancelled';
        volume = order.filled;
        switch (client.type) {
          case 'kraken':
            closeDate = new Date(order.info.closetm * 1000);
            break;

          case 'coinbase':
            closeDate = new Date(order.info.last_fill_time);
            break;
        }
      } else if (status === 'open') {
        fees = order.type == 'market' ? client.takerFees : client.makerFees;
        volume = order.remaining;
        switch (client.type) {
          case 'coinbase':
            cost = volume * order.price;
            cost += fees * volume;
            break;

          case 'kraken':
            if (!order.timestamp) openDate = new Date();
            break;
        }
      }

      return new ExchangeOrder({
        txid: order.id,
        type: order.type,
        status: KrakenBot.ConvertKrakenStatusToExchangeOrder(status, order),
        side: order.side,
        openDate: openDate,
        closeDate: closeDate,
        volume: order.amount,
        price: order.price,
        cost: cost,
        fees: fees,
        userref: order.clientOrderId,
        pair: order.symbol?.toLowerCase(),
      });
    } catch (e) {
      App.rethrow(e);
      App.printObject(order);
      App.error(`Failed to convert ${client.type} order`);
    }
  }

  /**
   * @param {any} precisionMode
   * @param {Number} value
   */
  static ConvertPrecision(precisionMode, value) {
    switch (precisionMode) {
      case ccxt.TICK_SIZE: {
        let valueString = value.toString();
        if (valueString.startsWith('1e-')) return Number(valueString.split('-')[1]);
        else return valueString.split('.')[1]?.length || 0;
      }

      default:
        return value;
    }
  }
}

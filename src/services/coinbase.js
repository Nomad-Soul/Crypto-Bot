import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import axios from 'axios';
import App from '../app.js';
import ClientBase from './client.js';
import ExchangeOrder from '../data/exchange-order.js';
import { redBright, yellowBright, cyanBright, greenBright } from 'ansis';
import PairData from '../data/pair-data.js';
import EcaOrder from '../data/eca-order.js';
import Action from '../data/action.js';
import BotSettings from '../data/bot-settings.js';

export default class CoinbaseClient extends ClientBase {
  /**
   *
   * @param {import('../types.js').AccountSettings} accountSettings
   */
  constructor(accountSettings) {
    super(accountSettings);
  }

  static ConvertStatusToCoinbase(status) {
    var cbStatus = '';
    switch (status) {
      case 'closed':
        cbStatus = 'FILLED';
        break;

      case 'open':
        cbStatus = 'OPEN';
        break;
    }
    return cbStatus;
  }

  async updateAccountList() {
    var accounts = [];

    this.submitRequest('accounts', 'GET', { limit: 50 })
      .then((response) =>
        response.data.accounts.forEach((account) => {
          accounts.push({
            uuid: account.uuid,
            currency: account.currency,
            available: account.available_balance.value,
          });
          this.balances.set(PairData.GetAliasCurrency(account.currency), Number(account.available_balance.value));
        }),
      )
      .finally(() => App.writeFile(`${App.DataPath}/exchanges/${this.type}-accounts`, accounts));
  }

  async requestBalance() {
    App.log(greenBright`Requesting balance from ${this.id}`);
    await this.updateAccountList();
    return Object.fromEntries(this.balances);
  }

  async requestPairList() {
    App.log(greenBright`Requesting pair list for ${this.id}`);
    return this.submitRequest('products', 'GET', { limit: 500 }).then((r) => {
      r.data.products.forEach((p) => {
        let pair = `${p.base_currency_id.toLowerCase()}/${p.quote_currency_id.toLowerCase()}`;
        this.pairs.set(pair, CoinbaseClient.ConvertCoinbasePairData(p));
      });
      App.writeFile(`${App.DataPath}/exchanges/${this.type}-pairs`, Object.fromEntries([...this.pairs.entries()]));
    });
  }

  /**
   *
   * @param {Action} action
   * @returns
   */
  async submitOrder(action) {
    var order = action.order;
    App.log(`[${order.id}]: submitting ${yellowBright`${order.type} order ${order.direction} at ${order.price} on ${order.account}`}`);
    var data = CoinbaseClient.ActionToCoinbaseOrder(action);
    App.printObject(data);
    return this.submitRequest('orders', 'POST', data);
  }

  /**
   *
   * @param {Action} action
   * @returns
   */
  async cancelOrder(action) {
    var order = action.order;
    App.log(`[${order.id}]: cancelling ${yellowBright`${order.type} order ${order.direction} at ${order.price} on ${order.account}`}`);
    let data = {
      order_ids: [order.txid],
    };
    return this.submitRequest('orders/batch_cancel', 'POST', data);
  }

  async requestOrders(status, options = undefined) {
    const { num, startDate } = options || { num: 100, startDate: new Date('01/01/2024') };

    var requestedStatus = CoinbaseClient.ConvertStatusToCoinbase(status);
    if (requestedStatus === 'FILLED') requestedStatus = 'CANCELLED';
    return this.submitRequest('orders/historical/batch', 'GET', {
      order_status: requestedStatus,
      start_date: startDate.toISOString(),
      limit: num,
    });
  }

  async requestOrdersByStatus(status, options = undefined) {
    App.log(`${cyanBright`Downloading`} ${this.id} ${status} orders`);
    return this.requestOrders(status, options).then(
      (response) =>
        new Promise((resolve, reject) => {
          App.log(`Received ${cyanBright`${response.data.orders.length} ${status} orders`} from ${this.id}`, true);
          if (this.updateOrders(response.data.orders, status)) resolve(true);
          else reject(false);
        }),
    );
  }

  /**
   *
   * @param {string[]} pairs
   * @returns {Promise<any>}
   */
  async requestTickers(pairs) {
    App.log(greenBright`Updating prices from ${this.id}`);
    var tickers = {};
    var promises = [];
    pairs.forEach((pair) =>
      promises.push(this.submitRequest(`products/${pair}`, 'GET').then((response) => (tickers[response.data.product_id] = response.data.price))),
    );

    return Promise.allSettled(promises).then(() => tickers);
  }

  /**
   *
   * @param {any[]} orders
   * @param {string} status
   * @returns {boolean}
   */
  updateOrders(orders, status) {
    if (typeof orders === 'undefined') {
      App.log(`No ${this.id} ${status} orders received`);
      return false;
    }
    let statusOrders = orders.filter((order) => order.status === CoinbaseClient.ConvertStatusToCoinbase(status));
    let statusObject = {};

    statusOrders.forEach((order) => {
      this.setExchangeOrder(order.order_id, order);
      statusObject[order.order_id] = order;
    });

    return true;
  }

  /**
   *
   * @param {string} endpoint
   */
  async submitRequest(endpoint, method = 'GET', data = undefined) {
    const request_method = method;
    const url = 'api.coinbase.com';
    const request_path = `/api/v3/brokerage/${endpoint}`;
    const service_name = 'retail_rest_api_proxy';

    const algorithm = 'ES256';
    const uri = request_method + ' ' + url + request_path;

    // @ts-ignore
    const token = jwt.sign(
      {
        aud: [service_name],
        iss: 'coinbase-cloud',
        nbf: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 120,
        sub: this.apiPublicKey,
        uri,
      },
      this.apiPrivateKey,
      {
        // @ts-ignore
        algorithm,
        header: {
          kid: this.apiPublicKey,
          nonce: crypto.randomBytes(16).toString('hex'),
        },
      },
    );

    let request_url = `https://api.coinbase.com${request_path}`;

    if (method === 'GET' && typeof data != 'undefined' && data != null) {
      request_url +=
        '?' +
        Object.entries(data)
          .map((kv) => kv.map(encodeURIComponent).join('='))
          .join('&');
    }

    //console.log(request_url);

    let config = {
      method: method.toLowerCase(),
      url: request_url,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
    };

    if (method === 'POST') config.data = JSON.stringify(data);
    // @ts-ignore
    return axios(config).catch((error) => {
      //App.printObject(error);
      App.error(`Invalid request from: ${request_path}`, false);
      App.log(`\t${error.code}: ${error.error}`);
      App.log('\t' + error.message);
      App.printObject(error.details, false);
      throw new Error('Invalid request');
    });
  }

  async queryOrder(txid) {
    return this.submitRequest(`orders/historical/${txid}`, 'GET').then((response) => response.data.order);
  }

  getTxidFromResponse(response) {
    if (typeof response.data === 'undefined') {
      App.printObject(response.data);
      App.error('No data received');
    }
    return response.data.success_response.order_id;
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

    App.log(`Checking pending order ${plannedOrder.id}`);

    if (exchangeOrder.status === 'FILLED') {
      plannedOrder.status = 'executed';
      plannedOrder.closeDate = exchangeOrder.closeDate;
      plannedOrder.volumeQuote = exchangeOrder.cost;
      result = true;
      newStatus = plannedOrder.status;
    } else result = false;

    return new Promise((resolve) => resolve({ result: result, newStatus: newStatus }));
  }

  async processAction(action) {
    var response = await this.executeAction(action);
    //App.printObject(action);
    if (!response.data.success) {
      App.log(redBright`Response follows:`, true);
      let error = response.data.error_response;
      App.printObject(error);
      App.printObject(response.data);
      App.error(error.preview_failure_reason, false);
      App.error(error.message, false);
      throw new Error(error.error);
    } else {
      App.log(greenBright`Response follows:`, true);
      App.printObject(response.data.success_response);
    }
    App.log(yellowBright`----- end -----`);
    return response;
  }

  /**
   *
   * @param {BotSettings} botSettings
   * @returns
   */
  getPairId(botSettings) {
    return `${botSettings.base}-${botSettings.quote}`.toUpperCase();
  }

  convertResponseToExchangeOrder(response) {
    return CoinbaseClient.ConvertToExchangeOrder(response);
  }

  /**
   *
   * @param {string[]} txidArray
   * @returns
   */
  async requestOrdersByTxid(txidArray) {
    return true;
  }

  /**
   *
   * @param {any} txinfo
   * @returns {ExchangeOrder}
   */
  static ConvertToExchangeOrder(txinfo) {
    try {
      var type = txinfo.order_type === 'LIMIT' ? 'limit' : 'market';
      var status = txinfo.status === 'FILLED' ? 'closed' : 'open';

      // App.error('CB transaction:', false);
      // App.printObject(txinfo);
      return new ExchangeOrder({
        type: type,
        status: status,
        side: txinfo.side.toLowerCase(),
        openDate: new Date(txinfo.created_time),
        closeDate: status === 'open' ? undefined : new Date(txinfo.last_fill_time),
        volume: Number(txinfo.filled_size),
        price: Number(type === 'market' ? txinfo.average_filled_price : txinfo.order_configuration.limit_limit_gtc.limit_price),
        cost: Number(
          txinfo.filled_value == 0
            ? txinfo.order_configuration.limit_limit_gtc.limit_price * txinfo.order_configuration.limit_limit_gtc.base_size
            : txinfo.filled_value,
        ),
        fees: Number(txinfo.total_fees),
        txid: txinfo.order_id,
        userref: txinfo.client_order_id,
        pair: txinfo.product_id.replace('-', '/').toLowerCase(),
      });
    } catch (e) {
      console.log(txinfo);
      App.log('--');
      App.rethrow(e);
    }
  }

  /**
   *
   * @param {any} pair
   * @returns {PairData}
   */
  static ConvertCoinbasePairData(pair) {
    try {
      var base = pair.base_currency_id.toLowerCase();
      var quote = pair.quote_currency_id.toLowerCase();

      return new PairData({
        id: `${base}/${quote}`,
        base: base,
        quote: quote,
        nativeBaseId: pair.base_currency_id,
        nativeQuoteId: pair.quote_currency_id,
        minVolume: Number(pair.base_min_size),
        maxBaseDigits: pair.base_increment.split('.')[1]?.length || 0,
        maxQuoteDigits: pair.quote_increment.split('.')[1]?.length || 0,
        minBaseDisplayDigits: pair.base_min_size.split('.')[1]?.length || 0,
      });
    } catch (e) {
      App.warning(pair.product_id);
      App.printObject(pair);
      App.rethrow(e);
    }
  }

  /**
   *
   * @param {Action} action
   * @returns {any}
   */
  static ActionToCoinbaseOrder(action) {
    action.performChecks();
    var orderConfig = {};
    var order = action.order;

    switch (action.order.type) {
      case 'limit':
        orderConfig = {
          limit_limit_gtc: {
            base_size: (order.volumeQuote / order.price).toFixed(action.pairData.maxBaseDigits).toString(),
            limit_price: order.price.toFixed(4).toString(),
            post_only: true,
          },
        };
        break;
      case 'market':
        orderConfig = {
          market_market_ioc: {
            quote_size: order.volumeQuote.toString(),
          },
        };
        break;
    }

    var data = {
      client_order_id: order.id,
      product_id: `${action.pairData.base}-${action.pairData.quote}`.toUpperCase(),
      side: order.direction.toUpperCase(),
      order_configuration: orderConfig,
    };

    switch (action.command) {
      case 'submitOrder':
        break;

      default:
        App.log(`Unknown command ${action.command} // ${action.order?.id}`);
    }

    return data;
  }
}

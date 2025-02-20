import App from './app.js';
import { redBright, yellowBright, cyanBright, greenBright, magentaBright } from 'ansis';
import BotSettings from './data/bot-settings.js';
import CryptoBot from './crypto-bot.js';
import EcaOrder from './data/eca-order.js';
import PairData from './data/pair-data.js';
import TraderDeal from './data/trader-deal.js';
import DealPlanner from './strategies/deal-planner.js';
import Utils from './utils.js';

export default class Renderer {
  #currency;
  #bot;

  /**
   *
   * @param {CryptoBot} bot
   */
  constructor(bot) {
    this.#bot = bot;
    this.#currency = Intl.NumberFormat(App.locale, { style: 'currency', currency: bot.appCurrency });
  }

  async renderOrderSchedule() {
    var bots = this.#bot.getAllBots();
    var html = '';
    var entries = 0;
    var data = [];
    for (let [botId, bot] of Object.entries(bots)) {
      App.log(`Rendering schedule for ${cyanBright`${bot.fullId}`}`);
      if (typeof bot.strategy !== 'object') continue;
      data = data.concat([...bot.strategy.getPlannedOrders()]);
    }

    data = data.sort((a, b) => b.order.openDate.getTime() - a.order.openDate.getTime());

    for (let ecaOrder of data) {
      if (++entries > 100) break;
      let botSettings = this.#bot.getBotSettings(ecaOrder.botId);
      let order = ecaOrder.order;
      let price = order.price;
      let cost = 0;
      let volume = order.cost / price;
      let date = order.closeDate ?? order.openDate;
      let dateClass = '';
      let costClass = 'text-warning';
      let status = order.status;
      let statusClass = 'text-neutral';

      if (order.isClosed) {
        volume = order.volume;
        cost = order.cost;
        if (order.status === 'closed') {
          costClass = 'text-success';
          date = order.closeDate;
        } else {
          statusClass = 'text-danger';
          date = order.openDate;
        }
      } else if (order.status === 'pending') {
        statusClass = 'text-info';
        volume = order.volume;
        cost = price * Math.max(volume, botSettings.minVolume);
        date = order.openDate;
      } else if (order.status === 'planned') {
        cost = 0;
        date = new Date(order.openDate);
        // if (order.isScheduledForToday) {
        //   statusClass = dateClass = 'text-info';
        // } else
        statusClass = dateClass = 'text-primary';
      }

      // order.openDate = exchangeOrder.openDate;
      // order.closeDate = exchangeOrder.closeDate;
      // order.volumeQuote = exchangeOrder.cost;

      if (typeof date === 'undefined') date = order.closeDate;

      //console.log(order);
      try {
        html += `<div class="row mt-2" data-id="${order.txid ?? ''}">
        <div class="col-md-1 col-2 text-start"><span class="badge ${botSettings.badgeClass}">${botSettings.base}</span></div>
        <div class="col-md-2 col-5 text-start ${dateClass}" title="${Utils.toShortTime(date)}">${Utils.toShortDate(date)}</div>
        <div class="col-md-1 col-2 text-start ${statusClass}">${order.side}</div>
        <div class="col-md-2 col-3 text-end ${costClass}">${Number(volume).toFixed(4)}</div>
        <div class="col-md-2 col-4 text-end order-md-1 order-2 ${costClass}">${cost > 0 ? this.#currency.format(cost) : '-'}</div>
        <div class="col-md-2 col-4 text-start ${statusClass}" title="${order.txid}" >${ecaOrder.status}</div>
        <div class="col-md-2 col-4 text-start text-neutral">${ecaOrder.account}</div>
    </div>`;
      } catch (e) {
        App.printObject(order);
        App.error(`Invalid data: ${order.txid}$`, false);
        App.rethrow(e);
      }
    }

    //this.#bot.updatePlanSchedule();
    return { html: html };
  }

  async renderActiveBots() {
    var bots = this.#bot.getAllBots();
    var botIds = Object.keys(bots);

    var html = `<div class="row mt-2 text-neutral">
      <div class="col-md-2 d-md-block d-none text-md-end">ECA</div>
      <div class="col-md-1 d-md-block d-none text-end">Type</div>
      <div class="col-md-2 d-md-block d-none text-md-end">Frequency</div>
      <div class="col-md-1-5 d-md-block d-none text-md-center text-center">Last</div>
      <div class="col-md-1 d-md-block d-none text-md-start">Exchange</div>
      <div class="col-md-1-5 col-5 text-md-end text-center">Average Price</div>
      <div class="col-md-1-5 col-4 text-md-end text-end">Total €</div>
      <div class="col-md-1-5 col-3 text-md-end text-center">Total Volume</div>
    </div>
    `;

    var dataset = new Map();
    for (let i = 0; i < botIds.length; i++) {
      let botSettings = bots[botIds[i]];
      if (!botSettings.active || botSettings.strategyType != 'eca-stacker') continue;

      App.log(`Rendering overall stats for ${cyanBright`${botSettings.fullId}`}`);

      var client = this.#bot.getClient(botSettings.account);
      let pair = botSettings.pair;

      await client.awaitPrices();
      let currentPrice = client.getPrice(pair);

      // let data = botSettings.strategy.strategyOrders['executed'];
      let orders = botSettings.strategy.getPlannedOrders('executed');

      let weightedAverage = orders.reduce(
        (accumulator, ecaOrder) => [
          {
            weightedSum: accumulator[0].weightedSum + ecaOrder.order.cost + ecaOrder.order.fees,
            sum: accumulator[0].sum + ecaOrder.order.volume,
          },
        ],
        [{ weightedSum: 0, sum: 0 }],
      );

      let pairData = client.getPairData(pair);
      let groupByMonth = orders.reduce((groupBy, ecaOrder) => {
        let order = ecaOrder.order;
        const label = `${order.closeDate.getFullYear()} ${order.closeDate.getMonth()}`;
        if (!Object.hasOwn(groupBy, label)) groupBy[label] = { volume: 0, volumeQuote: 0, fees: 0 };
        groupBy[label].volume += order.volume;
        groupBy[label].volumeQuote += order.cost;
        groupBy[label].fees += order.fees;
        return groupBy;
      }, {});

      let data = {
        aggregate: Utils.orderObjectByKeys(groupByMonth),
        base: pairData.base,
        quote: pairData.quote,
      };

      dataset.set(botIds[i], data);

      let desiredAmount = Math.max(botSettings.maxVolumeQuote, pairData.minVolume * currentPrice);
      let averagePrice = weightedAverage.map((value) => value.weightedSum / value.sum)[0];
      let costUnit = '';

      let totalVolumeBought = weightedAverage.map((value) => value.sum)[0];
      let totalSpent = weightedAverage[0].weightedSum;
      let frequency = Number(botSettings.options.frequency);
      let frequencyText = `${frequency.toFixed(2)} h`;
      if (botSettings.options.type != 'recurring') {
        frequencyText = `on the ${botSettings.options.day}`;
      }

      let averageClass = 'text-neutral';
      let amountClass = 'text-success';
      if (currentPrice > averagePrice) averageClass = 'text-success';
      else averageClass = 'text-danger';

      var executedOrders = botSettings.strategy.getPlannedOrders().filter((o) => o.status === 'executed');
      var lastDateString = 'never';
      if (executedOrders.length > 0) lastDateString = App.toShortDate(executedOrders[executedOrders.length - 1].order.closeDate);

      if (desiredAmount > botSettings.maxVolumeQuote) amountClass = 'text-danger';

      if (averagePrice > 10000) {
        averagePrice /= 1000;
        costUnit = 'k';
      }

      html += `<div class="row mt-2" data-groupBy="${JSON.stringify(groupByMonth)}">
        <div class="col-md-1 col-2 text-start"><span class="badge ${botSettings.badgeClass}">${botSettings.base}</span></div>
        <div class="col-md-1 d-md-block d-none text-end ${amountClass}">${Number(desiredAmount).toFixed(2)}</div>
        <div class="col-md-1 d-md-block d-none text-end">${botSettings.options.type}</div>
        <div class="col-md-2 d-md-block d-none text-md-end">${frequencyText}</div>
        <div class="col-md-1-5 d-md-block d-none text-start">${lastDateString}</div>
        <div class="col-md-1 d-md-block d-none text-md-start small">${botSettings.account}</div>
        <div class="col-md-1-5 col-3 text-md-end text-end ${averageClass}" title="${pairData.id}: ${currentPrice.toFixed(2)}">${Number(averagePrice).toFixed(2)}${costUnit}</div>
        <div class="col-md-1-5 col-4 text-end text-info">${Number(totalSpent).toFixed(2)}&thinsp;€</div>
        <div class="col-md-1-5 col-3 text-end text-info">${Number(totalVolumeBought).toFixed(Math.min(pairData.minBaseDisplayDigits, 4))}</div> 

      </div>`;
    }

    return { html: html, data: Object.fromEntries(dataset.entries()), chartType: 'stackerBot' };
  }

  /**
   *
   * @param {string} accountId
   * @returns
   */
  renderBalanceBlocks(accountId) {
    var accountClient = this.#bot.getClient(accountId);

    var html = `<div class="col-md-3 col-5 p-4 rounded bg-dark-container me-4 mb-2">
    <div class="row">
      <div class="col"><h4>${accountId.charAt(0).toUpperCase() + accountId.slice(1)}</h4></div>
    </div>`;
    [...accountClient.balances.keys()].forEach((key) => {
      var pairData = accountClient.getPairData(`${PairData.GetAliasCurrency(key)}/${this.#bot.appCurrency}`);
      var minBaseDisplayDigits = pairData?.minBaseDisplayDigits || 2;

      let balance = accountClient.balances.get(key);
      if (accountClient.watchBalance.includes(key) && balance > 0) {
        html += `<div class="row">
          <div class="col-3 text-start">
            <span id="bal-${key}-id" class="badge bg-primary">${key}</span>
          </div>
        <div class="col-9 text-end" >
          <span id="bal-${key}-value" >${balance.toFixed(minBaseDisplayDigits)}</span>
        </div>
      </div>`;
      }
    });
    // [...accountClient.balances.entries()].forEach(([key, value]) => {});
    html += '</div>';
    return { html: html };
  }

  /**
   *
   * @param {EcaOrder[]} orders
   * @param {any} accountSettings
   * @returns
   */
  renderDealPreviewTotal(orders, accountSettings) {
    const { makerFees, takerFees } = accountSettings;
    var total = orders.reduce((sum, ecaOrder) => {
      let order = ecaOrder.order;
      let volumeCurrency = Number(ecaOrder.volumeQuote);
      let fees = Number(order.fees);
      sum += volumeCurrency + fees;
      return sum;
    }, 0);

    let volume = Number(orders[orders.length - 1].order.volume);
    let sellCurrency = Number(orders[orders.length - 1].volumeQuote);
    let sellFees = Number(orders[orders.length - 1].order.fees);
    let buyCurrency = Number(orders[0].volumeQuote);
    let buyFees = Number(orders[0].order.fees);
    let buyPrice = Number(orders[0].order.price);
    //App.warning([sellCurrency, makerFees, sellCurrency, buyCurrency, buyFees]);
    let profit = sellCurrency - sellFees - buyCurrency - buyFees;
    let margin = profit / (buyCurrency - buyFees);
    let lastSO = Number(orders.filter((o) => o.order.side === 'buy').slice(-1)[0].order.price);

    return `
      <div class="row border-top">
          <div class="col-4 text-start fw-bold">Total:</div>
          <div class="col-2 text-end">${total.toFixed(2)} €</div>
          <div class="col-2 text-start fw-bold">Profit</div>
          <div class="col-4 text-end text-success">${(margin * 100).toFixed(2)}% (${profit.toFixed(2)}€)</div>
    </div>
    <div class="row mb-4">
          <div class="col-6 text-start"></div>
          <div class="col-4 text-start fw-bold">Deviation</div>
          <div class="col-2 text-end text-danger">${(100 - (lastSO / buyPrice) * 100).toFixed(2)} %</div>
    </div>
  </div>`;
  }

  /**
   *
   * @param {EcaOrder} orderData
   * @param {PairData} pairData
   * @returns
   */
  renderOrder(orderData, pairData) {
    let textClass = orderData.order.side === 'sell' ? 'text-success' : 'text-danger';
    let iconClass = orderData.order.side === 'sell' ? 'bi-arrow-up' : 'bi-arrow-down';
    var datestring = Utils.toShortDate(orderData.order.closeDate ?? orderData.order.openDate);

    let orderPrice = Number(orderData.order.price);
    let base = pairData.base.toUpperCase();
    let quote = pairData.quote.toUpperCase();
    let vol = Number(orderData.order.volume);
    let volEuro = vol * orderPrice;
    let feeEuro = Number(orderData.order.fees);

    if (isNaN(volEuro)) {
      App.printObject(orderData);
      App.error('Invalid volume in base currency');
    }

    let row = `
      <div class="row">
          <div class="col-3 text-start">${datestring}</div>
          <div class="col-2-5 text-start fw-bold ${textClass}"><i class="bi ${iconClass}"></i>${orderData.order.side} ${orderData.order.type}</div>
          <div class="col-1-5 text-end text-info">${volEuro.toFixed(2)} €</div>
          <div class="col-1-5 text-end text-danger">${feeEuro.toFixed(2)} €</div>
          <div class="col-3-5 text-end">${vol.toFixed(4)} ${base} @ ${orderPrice.toFixed(2)} ${quote}</div>
      </div>`;

    return row;
  }

  /**
   *
   * @param {string} botId
   * @param {EcaOrder[]} orders
   * @returns
   */
  renderPreview(botId, orders) {
    var botSettings = this.#bot.getBotSettings(botId);
    var accountClient = this.#bot.getClient(botSettings.account);
    var pairData = accountClient.getPairData(botSettings.pair);
    var html = '<div class="bg-dark-container p-md-4 p-2 mt-4"> <div class="row"><h4>New deal preview</h4></div>';
    for (const order of orders) {
      html += this.renderOrder(order, pairData);
    }

    html += this.renderDealPreviewTotal(orders, {
      makerFees: accountClient.makerFees,
      takerFees: accountClient.takerFees,
    });
    return { html: html };
  }

  /**
   *
   * @param {TraderDeal} openDeal
   * @returns { Promise<{html: string}>}
   */
  async renderOpenDeal(openDeal) {
    if (!openDeal) {
      return {
        html: `<div class="bg-dark-container p-md-4 p-2"><div class="row">
    <h5 class="text-start">No active deals</h5>
  </div></div>`,
      };
    }

    var client = this.#bot.getClient(openDeal.account);

    if (!client.active) {
      return {
        html: `<div class="bg-dark-container p-md-4 p-2"><div class="row">
    <h5 class="text-start">Client ${client.id} for ${client.type} is not active</h5>
  </div></div>`,
      };
    }
    var dealPlanner = new DealPlanner(this.#bot, openDeal.botId);
    var botSettings = this.#bot.getBotSettings(openDeal.botId);
    var strategy = botSettings.strategy;
    var pairData = client.getPairData(botSettings.pair);

    let orders = openDeal.orders.map((id) => strategy.getPlannedOrder(id));

    if (orders.some((o) => typeof o === 'undefined' || o === null)) {
      App.printObject(orders);
      App.error('Null orders found!', false);
      return {
        html: `<div class="bg-dark-container p-md-4 p-2"><div class="row">
    <h5 class="text-start">Deal contains non-existing orders.</h5>
  </div></div>`,
      };
    }

    await client.awaitPrices();
    await client.awaitBalances();

    let closedOrders = orders.filter((ecaOrder) => ecaOrder.order.isClosed).sort((a, b) => a.order.closeDate.getTime() - b.order.closeDate.getTime());

    let nextBuyOrder = orders.find((ecaOrder) => !ecaOrder.order.isClosed && ecaOrder.order.side === 'buy') ?? dealPlanner.calculateSafetyOrder(openDeal);
    let takeProfitOrder = openDeal.sellOrders[0] ? strategy.getPlannedOrder(openDeal.sellOrders[0]) : dealPlanner.proposeTakeProfitOrder(openDeal);

    let takeProfitPrice = takeProfitOrder.order.price;

    let safetyOrderPrice = nextBuyOrder.order.price;
    let deltaSafety = (takeProfitPrice - safetyOrderPrice) / 2;

    const { averagePrice, costBasis, targetPrice } = openDeal.calculateProfitTarget(this.#bot, botSettings);

    if (averagePrice == null || typeof averagePrice == 'undefined') App.error('null averageprice');
    else App.log(`AveragePrice is ${averagePrice}`);

    let currentPrice = client.getPrice(botSettings.pair);

    let widthPnL =
      currentPrice > averagePrice
        ? (currentPrice - averagePrice) / (takeProfitPrice - averagePrice)
        : (currentPrice - averagePrice) / (averagePrice - safetyOrderPrice);

    widthPnL *= 50;
    widthPnL = Math.max(-50, Math.min(50, widthPnL));
    let widthLoss = Math.min(widthPnL < 0 ? Math.abs(widthPnL) : 0, 50);
    let widthSafety = widthPnL < 0 ? 50 - widthLoss : 50;
    let widthProfit = widthPnL < 0 ? 0 : widthPnL;

    App.printObject({
      nextBuy: {
        txid: nextBuyOrder.order.txid,
      },
      width: {
        PnL: widthPnL,
        loss: widthLoss,
        safety: widthSafety,
        profit: widthProfit,
      },
      price: {
        current: currentPrice,
        average: averagePrice,
        takeProfit: takeProfitPrice,
        safetyOrder: safetyOrderPrice,
      },
    });

    let volumeProfit = Number(takeProfitOrder.order.volume);
    let volumeProfitQuote = volumeProfit * takeProfitPrice;
    let volumeSafetyQuote = Number(nextBuyOrder.order.volume * safetyOrderPrice);
    let pnlType = widthPnL < 0 ? 'text-danger' : 'text-success';
    let pnlPercent = (100 * (currentPrice - averagePrice)) / averagePrice;
    let pnlValue = volumeProfit * currentPrice - averagePrice * volumeProfit;
    let profitPotential = volumeProfitQuote - volumeProfit * averagePrice - volumeProfitQuote * 0.0016;
    let profitPercent = 100 * ((takeProfitPrice - averagePrice) / averagePrice - 0.0016);

    let labelLoss = widthPnL < 0 ? currentPrice.toFixed(pairData.maxQuoteDigits) : '';
    let labelProfit = widthPnL < 0 ? '' : currentPrice.toFixed(pairData.maxQuoteDigits);

    var quoteCurrency = pairData.quote.toUpperCase();

    var nextClass = 'text-neutral';
    if (dealPlanner.maxSafetyOrders + 1 === openDeal.buyOrders.length) nextClass = 'text-warning';

    let dealTemplate = `
    <div class="bg-dark-container p-md-4 p-2"><div class="row">
      <div class="col-9">
        <h5 class="text-start">Active <span class="text-info">${pairData.id}</span> deal: <code>${openDeal.id}</code> </h5>
      </div>
      <div class="col-3 text-end text-neutral">
        <h5>${Utils.timeToHoursOrDaysText(orders.at(0).hoursElapsed())} old</h5>
      </div>
    </div>
      <div class="row">
          <div class="col-4 text-start">${safetyOrderPrice.toFixed(2)}</div>
          <div class="col-4 text-center">${averagePrice.toFixed(2)}</div>
          <div class="col-4 text-end">${takeProfitPrice.toFixed(2)}</div>
      </div>
      <div class="row">
          <div class="col">
              <div class="progress">
                  <div class="progress-bar bg-secondary" role="progressbar" style="width: ${widthSafety.toFixed(4)}%" aria-valuenow="${widthSafety.toFixed(4)}" aria-valuemin="0" aria-valuemax="100"></div>
                  <div class="progress-bar bg-danger text-start" role="progressbar" style="width: ${widthLoss.toFixed(4)}%; overflow:visible" aria-valuenow="${widthLoss.toFixed(4)}" aria-valuemin="0" aria-valuemax="100">${labelLoss !== '' ? labelLoss : ''}</div>
                  <div class="progress-bar bg-success text-end" role="progressbar" style="width: ${widthProfit.toFixed(4)}%; overflow:visible" aria-valuenow="${widthProfit.toFixed(4)}" aria-valuemin="0" aria-valuemax="100">${labelProfit !== '' ? labelProfit : ''}</div>
              </div>
          </div>
      </div>
      <div class="row">
          <div class="col-6">
              PnL: <span class="${pnlType}">${pnlPercent.toFixed(2)}% (${pnlValue.toFixed(2)} €)</span>
          </div>
          <div class="col-6">
              Potential: <span class="text-success">${profitPercent.toFixed(2)}% (${profitPotential.toFixed(2)} €)</span>
          </div>
      </div>
      <div class="row">
        <p class="lead text-start ${nextClass}">Next safety order: buy ${nextBuyOrder.order.volume} ${pairData.base} @ ${nextBuyOrder.order.price.toFixed(2)} (${(nextBuyOrder.order.volume * nextBuyOrder.order.price).toFixed(2)} ${quoteCurrency})</p>
      </div>
      `;

    for (let i = 0; i < closedOrders.length; i++) {
      let ecaOrder = closedOrders[i];
      if (ecaOrder.status === 'open') continue;
      dealTemplate += `<div class="row">
        <div class="col text-start">
          <span class="text-danger">${ecaOrder.order.type}</span> ${ecaOrder.order.side} <span class="text-info">${Number(ecaOrder.order.volume).toFixed(4)}</span> @ <span class="text-info">${Number(ecaOrder.order.price).toFixed(2)}  </span> (${(ecaOrder.order.volume * ecaOrder.order.price).toFixed(2)} ${quoteCurrency}) on ${Utils.toShortDateTime(ecaOrder.order.closeDate)}
        </div>
      </div>`;
    }
    dealTemplate += '</div>';
    return { html: dealTemplate };
  }
}

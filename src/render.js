import App from './app/app.js';
import { redBright, yellowBright, cyanBright, greenBright, magentaBright } from 'ansis';
import BotSettings from './data/bot-settings.js';
import CryptoBot from './crypto-bot.js';
import EcaOrder from './data/eca-order.js';
import PairData from './data/pair-data.js';
import TraderDeal from './data/trader-deal.js';
import DealPlanner from './strategies/deal-planner.js';
import Utils from './utils.js';
import EcaTrader from './strategies/eca-trader.js';
import ClientBase from './services/client.js';
import Terminal from './app/terminal.js';

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

  async test() {
    return { data: [1, 2, 3] };
  }

  async renderOrderSchedule() {
    var term = Terminal.instance;
    var bots = this.#bot.getAllBots();
    var html = '';
    var entries = 0;
    var data = [];
    for (let [botId, bot] of Object.entries(bots)) {
      Terminal.log(`Rendering schedule for ${cyanBright`${bot.fullId}`}`);
      if (typeof bot.strategy !== 'object') continue;
      let plannedOrders = await bot.strategy.getPlannedOrders();
      data = data.concat([...plannedOrders]);
    }

    data = data.sort((a, b) => b.order.openDate.getTime() - a.order.openDate.getTime());
    var elements = [];
    for (let ecaOrder of data) {
      let botSettings = this.#bot.getBotSettings(ecaOrder.botId);
      let client = this.#bot.getClient(ecaOrder.account);
      let order = ecaOrder.order;
      let pairData = client.getPairData(order.pair);
      let price = order.price;
      let cost = 0;
      let volume = order.cost / price;
      let date = order.closeDate ?? order.openDate;
      let dateClass = '';
      let costClass = 'text-warning';
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
        date = order.openDate;

        await client.awaitPrices();
        volume = ecaOrder.volumeQuote / client.getPrice(order.pair);
        cost = ecaOrder.volumeQuote;

        if (order.isScheduledForToday) {
          statusClass = dateClass = 'text-info';
        } else statusClass = dateClass = 'text-primary';
      }

      if (typeof date === 'undefined') date = order.closeDate;

      let volumeRounded = Number(volume.toFixed(6));

      try {
        elements.push({
          txid: order.txid,
          badgeClass: botSettings.badgeClass,
          dateClass: dateClass,
          statusClass: statusClass,
          costClass: costClass,
          date: Utils.toShortDate(date),
          time: Utils.toShortTime(date),
          base: botSettings.base,
          side: order.side,
          volume: volumeRounded,
          cost: cost > 0 ? this.#currency.format(cost) : '-',
          status: ecaOrder.status,
          account: ecaOrder.account,
        });
        //     html += `<div class="row mt-2" data-id="${order.txid ?? ''}">
        //     <div class="col-md-1 col-2 text-start"><span class="badge ${botSettings.badgeClass}">${botSettings.base}</span></div>
        //     <div class="col-md-2 col-5 text-start ${dateClass}" title="${Utils.toShortTime(date)}">${Utils.toShortDate(date)}</div>
        //     <div class="col-md-1 col-2 text-start ${statusClass}">${order.side}</div>
        //     <div class="col-md-2 col-3 text-end ${costClass}">${volumeRounded}</div>
        //     <div class="col-md-2 col-4 text-end order-md-1 order-2 ${costClass}">${cost > 0 ? this.#currency.format(cost) : '-'}</div>
        //     <div class="col-md-2 col-4 text-start ${statusClass}" title="${order.txid}" >${ecaOrder.status}</div>
        //     <div class="col-md-2 col-4 text-start text-neutral">${ecaOrder.account}</div>
        // </div>`;
      } catch (e) {
        term.printObject(order);
        term.error(`Invalid data: ${order.txid}$`, false);
        term.rethrow(e);
      }
    }

    //this.#bot.updatePlanSchedule();
    return { elements: elements };
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
      if (!botSettings.active || botSettings.strategyType != 'stacker') continue;

      Terminal.log(`Rendering overall stats for ${cyanBright`${botSettings.fullId}`}`);

      var client = this.#bot.getClient(botSettings.account);
      let pair = botSettings.pair;

      await client.awaitPrices();
      let currentPrice = client.getPrice(pair);

      let orders = await botSettings.strategy.getPlannedOrders('executed');

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
      let averageCost = weightedAverage.map((value) => value.weightedSum / value.sum)[0];
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
      if (currentPrice > averageCost) averageClass = 'text-success';
      else averageClass = 'text-danger';

      var executedOrders = (await botSettings.strategy.getPlannedOrders()).filter((o) => o.status === 'executed');
      var lastDateString = 'never';
      if (executedOrders.length > 0) lastDateString = App.toShortDate(executedOrders[executedOrders.length - 1].order.closeDate);

      if (desiredAmount > botSettings.maxVolumeQuote) amountClass = 'text-danger';

      if (averageCost > 10000) {
        averageCost /= 1000;
        costUnit = 'k';
      }

      html += `<div class="row mt-2" data-groupBy="${JSON.stringify(groupByMonth)}">
        <div class="col-md-1 col-2 text-start"><span class="badge ${botSettings.badgeClass}">${botSettings.base}</span></div>
        <div class="col-md-1 d-md-block d-none text-end ${amountClass}">${Number(desiredAmount).toFixed(2)}</div>
        <div class="col-md-1 d-md-block d-none text-end">${botSettings.options.type}</div>
        <div class="col-md-2 d-md-block d-none text-md-end">${frequencyText}</div>
        <div class="col-md-1-5 d-md-block d-none text-start">${lastDateString}</div>
        <div class="col-md-1 d-md-block d-none text-md-start small">${botSettings.account}</div>
        <div class="col-md-1-5 col-3 text-md-end text-end ${averageClass}" title="${pairData.id}: ${currentPrice.toFixed(2)}">${Number(averageCost).toFixed(2)}${costUnit}</div>
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
   * @returns
   */
  renderDealPreviewTotal(orders) {
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

    let profit = sellCurrency - sellFees - buyCurrency - buyFees;
    let margin = profit / (buyCurrency - buyFees);
    let lastSO = Number(orders.filter((o) => o.order.side === 'buy').slice(-1)[0].order.price);

    return {
      total,
      margin,
      profit,
      lastSO,
      buyPrice,
    };

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
   * @returns
   */
  renderOrder(orderData) {
    let textClass = orderData.order.side === 'sell' ? 'text-success' : 'text-danger';
    let iconClass = orderData.order.side === 'sell' ? 'bi-arrow-up' : 'bi-arrow-down';
    var dateText = Utils.toShortDate(orderData.order.closeDate ?? orderData.order.openDate);

    const { price, volume, side, type } = orderData.order;

    let volumeQuote = volume * price;
    let feeQuote = orderData.order.fees;

    if (isNaN(volumeQuote)) {
      Terminal.printObject(orderData);
      Terminal.error('Invalid volume in base currency');
    }

    return {
      textClass,
      iconClass,
      dateText,
      volume,
      price,
      volumeQuote,
      feeQuote,
      side,
      type,
    };
  }

  /**
   *
   * @param {BotSettings} botSettings
   * @param {ClientBase} client
   * @param {EcaOrder[]} orders
   * @returns
   */
  renderPreview(botSettings, client, orders) {
    const { base, quote, minBaseDisplayDigits, maxQuoteDigits } = client.getPairData(botSettings.pair);
    var dataOrders = [];
    //var html = '<div class="bg-dark-container p-md-4 p-2 mt-4"> <div class="row"><h4>New deal preview</h4></div>';
    for (const order of orders) {
      //html += this.renderOrder(order, pairData);
      dataOrders.push(this.renderOrder(order));
    }

    var preview = this.renderDealPreviewTotal(orders);
    return {
      base,
      quote,
      baseDigits: minBaseDisplayDigits,
      quoteDigits: maxQuoteDigits,
      orders: dataOrders,
      preview,
    };
  }

  /**
   *
   * @param {TraderDeal} openDeal
   * @param {BotSettings} botSettings
   * @returns
   */
  renderOpenDeal(openDeal, botSettings) {
    var term = Terminal.instance;
    if (!openDeal) {
      return {
        result: false,
        error: 'No active deals',
      };
    }

    // TODO: handle case of missing local order
    var client = this.#bot.getClient(openDeal.account);

    if (!client.active) {
      return {
        result: false,
        error: `Client ${client.id} for ${client.type} is not active`,
      };
    }
    var dealPlanner = new DealPlanner(this.#bot, openDeal.botId);
    var strategy = botSettings.strategy;
    var pairData = client.getPairData(botSettings.pair);

    let orders = openDeal.orders.map((id) => strategy.getPlannedOrder(id));

    if (orders.some((o) => typeof o === 'undefined' || o === null)) {
      term.printObject(orders);
      term.error('Null orders found!', false);
      return {
        result: false,
        error: 'Deal contains non-existing orders.',
      };
    }

    let closedOrders = orders.filter((ecaOrder) => ecaOrder.order.isClosed).sort((a, b) => a.order.closeDate.getTime() - b.order.closeDate.getTime());
    let nextBuyOrder = orders.find((ecaOrder) => !ecaOrder.order.isClosed && ecaOrder.order.side === 'buy') ?? dealPlanner.proposeSafetyOrder(openDeal);

    var sellOrders = openDeal.sellOrders.map((txid) => strategy.getPlannedOrder(txid)).filter((order) => order.isActive);
    var takeProfitOrder = sellOrders.length > 0 ? sellOrders[0] : dealPlanner.proposeTakeProfitOrder(openDeal);
    let takeProfitPrice = takeProfitOrder.order.price;

    let safetyOrderPrice = nextBuyOrder.order.price;
    let deltaSafety = (takeProfitPrice - safetyOrderPrice) / 2;

    const { averageCost: averageCost, costBasis, targetPrice } = openDeal.calculateProfitTarget(this.#bot, botSettings);

    if (averageCost == null || typeof averageCost == 'undefined') Terminal.error('null average cost');
    else Terminal.log(`Average Cost is ${averageCost}`);

    let currentPrice = client.getPrice(botSettings.pair);

    let widthPnL =
      currentPrice > averageCost
        ? (currentPrice - averageCost) / (takeProfitPrice - averageCost)
        : (currentPrice - averageCost) / (averageCost - safetyOrderPrice);

    widthPnL *= 50;
    widthPnL = Math.max(-50, Math.min(50, widthPnL));
    let widthLoss = Math.min(widthPnL < 0 ? Math.abs(widthPnL) : 0, 50);
    let widthSafety = widthPnL < 0 ? 50 - widthLoss : 50;
    let widthProfit = widthPnL < 0 ? 0 : widthPnL;

    Terminal.printObject({
      result: 'success',
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
        average: averageCost,
        takeProfit: takeProfitPrice,
        safetyOrder: safetyOrderPrice,
      },
    });

    let volumeProfit = Number(takeProfitOrder.order.volume);
    let volumeProfitQuote = volumeProfit * takeProfitPrice;
    let volumeSafetyQuote = Number(nextBuyOrder.order.volume * safetyOrderPrice);
    let pnlType = widthPnL < 0 ? 'text-danger' : 'text-success';
    let pnlPercent = (100 * (currentPrice - averageCost)) / averageCost;
    let pnlValue = volumeProfit * currentPrice - averageCost * volumeProfit;
    let profitPotential = volumeProfitQuote - volumeProfit * averageCost - volumeProfitQuote * 0.0016;
    let profitPercent = 100 * ((takeProfitPrice - averageCost) / averageCost - 0.0016);

    let labelLoss = widthPnL < 0 ? currentPrice.toFixed(pairData.maxQuoteDigits) : '';
    let labelProfit = widthPnL < 0 ? '' : currentPrice.toFixed(pairData.maxQuoteDigits);
    var quoteCurrency = pairData.quote.toUpperCase();

    var nextClass = 'text-neutral';
    if (dealPlanner.maxSafetyOrders + 1 === openDeal.buyOrders.length) nextClass = 'text-warning';

    var dealPreview = {
      result: true,
      botId: openDeal.botId,
      dealId: openDeal.id,
      timeElapsed: Utils.timeToHoursOrDaysText(orders.at(0).hoursElapsed()),
      nextBuyPrice: safetyOrderPrice,
      averageCost: averageCost,
      takeProfitPrice: takeProfitPrice,
      widthSafety: widthSafety,
      widthLoss: widthLoss,
      widthProfit: widthProfit,
      labelLoss: labelLoss,
      labelProfit: labelProfit,
      pnlClass: pnlType,
      pnlPercent: pnlPercent,
      pnlValue: pnlValue,
      profitPercent: profitPercent,
      profitPotential: profitPotential,
      nextBuyVolume: nextBuyOrder.order.volume,
      base: pairData.base,
      quote: pairData.quote,
      baseClass: botSettings.badgeClass,
    };

    return dealPreview;
  }

  /**
   * @param {string} botId
   * @returns
   */
  async renderTradePage(botId) {
    let trader = new EcaTrader(this.#bot, botId);
    let botSettings = this.#bot.getBotSettings(botId);
    var client = this.#bot.getClient(botSettings.account);
    await client.awaitPrices();
    await client.awaitBalances();
    var dealResult = trader.dealPlanner.proposeDeal(trader.client.getPrice(botSettings.pair), 4);
    var latestOpenDeal = trader.getLatestOpenDeal();
    //var openDealHtml = this.renderOpenDeal(latestOpenDeal, botSettings).html;
    //var dealPreviewHtml = this.renderPreview(botSettings, client, dealResult.orders).html;
    var openDeal = this.renderOpenDeal(latestOpenDeal, botSettings);
    var dealPreview = this.renderPreview(botSettings, client, dealResult.orders);

    return { openDeal, dealPreview };
  }
}

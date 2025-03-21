import { magentaBright, cyan, greenBright } from 'ansis';
import express from 'express';
import cron from 'node-cron';
import path from 'path';
import App from './app/app.js';
import Renderer from './render.js';
import CryptoBot from './crypto-bot.js';
import EcaTrader from './strategies/eca-trader.js';
import TradeHistory from './strategies/trade-history.js';
import Terminal from './app/terminal.js';

const __dirname = import.meta.dirname;

var bot = new CryptoBot();
App.bot = bot;
process.env.TZ = bot.getLocalSettings().timezone;

const server = express();
var port = bot.getServerPort();
var renderer = new Renderer(bot);

server.use(express.static('web'));
server.use(express.json());
server.use('/css', express.static(path.join(__dirname, '../node_modules/bootswatch/dist/darkly')));
server.use('/css', express.static(path.join(__dirname, '../node_modules/bootstrap-icons/font')));

App.server = server.listen(port, () => {
  (async () => {
    await bot.init();
    //await bot.rebuildHistory();
    var result = await bot.update();
  })();
});

server.set('view engine', 'ejs');

server.get('/', async function (req, res) {
  const orderSchedule = renderer.renderOrderSchedule();
  const tradePage = renderer.renderTradePage('bot-eth/eur');
  var promises = [orderSchedule, tradePage];
  Promise.allSettled(promises).then((results) => {
    res.render('index', {
      title: 'Crypto Bot',
      message: 'ciao',
      elements: results[0].value.elements,
      openDeal: results[1].value.openDeal,
      dealPreview: results[1].value.dealPreview,
    });
  });
});

server.get('/api', async function (req, res) {
  let target = req.query['target'].toString();
  Terminal.log(`/^C${target}^:[^G${formatEndpoint(req)}^:]: request from ${req.ip}`);

  let endpoint = req.query['endpoint'];
  var response;
  res.setHeader('Content-Type', 'application/json');

  switch (endpoint) {
    case 'Ticker':
      bot.updateTickers(response);
      break;

    case 'ShowSchedule': {
      response = await renderer.renderOrderSchedule();
      break;
    }

    case 'ShowActivePlans': {
      response = await renderer.renderActiveBots();
      break;
    }

    case 'Decide':
      response = await bot.processPlans();
      response = { status: 'success', data: response };
      break;

    case 'Balance': {
      let accountId = req.query['account'].toString();
      response = {
        balances: bot.getClient(accountId).balances,
        html: renderer.renderBalanceBlocks(accountId).html,
      };
      break;
    }

    case 'StartDeal': {
      let botId = req.query['botId'].toString();
      let botSettings = bot.getBotSettings(botId);
      if (botSettings.strategyType === 'trader') {
        var trader = new EcaTrader(bot, botId);
        response = await trader.startDeal();
      }
      break;
    }

    case 'TradeBalance': {
      let botId = req.query['botId'].toString();
      let groupBy = req.query['groupBy'].toString();
      let botSettings = bot.getBotSettings(botId);

      if (botSettings.active && botSettings.strategyType === 'trader') {
        var th = new TradeHistory(bot, botId);
        await th.analyseOrders({ verbose: true, redownload: false, saveTrades: true, saveDeals: true });
        response = {
          status: 'success',
          request: endpoint,
          data: th.calculatePnL(groupBy),
          chartType: 'traderBot',
          pair: bot.getBotSettings(botId).pair,
          groupBy: groupBy,
        };
      } else response = { status: 'failed' };
      break;
    }

    case 'PurchaseHistory': {
      let botId = req.query['botId'].toString();
      let purchases = new TradeHistory(bot, botId).reportPurchases(bot.getClient('kraken'));
      let pair = bot.getBotSettings(botId).pair;
      let data = await bot.getClient('kraken').requestCandleData({ pair: pair, interval: req.query['interval'], since: Number(req.query['startDate']) / 1000 });
      response = { status: 'success', pair: pair, request: endpoint, data: data, purchases: purchases, chartType: 'candlestick' };
      break;
    }

    case 'DealPreview': {
      let botId = req.query['botId'].toString();
      let botSettings = bot.getBotSettings(botId);
      if (!botSettings.active) {
        response = {
          status: 'success',
          request: 'endpoint',
          html: `Trader Bot <strong>${botId}</strong> is not active.`,
        };
      } else {
        response = {
          status: 'success',
          request: endpoint,
          html: await renderer.renderTradePage(botId),
        };
      }
      break;
    }

    case 'ClientSettings': {
      response = { status: 'success', clientSettings: bot.getClientSettings(), traderBotId: bot.getTraderBotIds()[0] };
      break;
    }

    default:
      console.debug(response);
      break;
  }

  if (response == null) {
    res.json({ status: 'failed' });
    Terminal.error(`[${endpoint}] no data received`);
    return;
  }

  res.json(response);
});

server.post('/api', async function (req, res) {
  let content = req.body;
  Terminal.log(`/api[${content.request}]: Received from ${req.ip}`);
  var response;

  switch (content.request) {
    default:
      response = { status: 'failed' };
      break;
  }
  res.setHeader('Content-Type', 'application/json');
  res.json(response);
});

cron.schedule('*/30 * * * *', () => {
  try {
    update().then(() => App.writeLog());
  } catch (error) {
    bot.telegramBot.log('Oh no!\n' + error);
    Terminal.log(error);
    App.writeLog();
  }
});

async function update() {}

function formatEndpoint(req) {
  let endpoint = `${req.query.endpoint}`;
  if (typeof req.query.params !== 'undefined') endpoint += `/${req.query.params}`;
  return endpoint;
}

import "dotenv/config";
import WebSocket from "ws";
import fetch from "node-fetch";
import colors from "colors/safe.js";
import blessed from "neo-blessed";
import open from "open";
import express from "express";
import columnify from "columnify";
import ora from "ora";

let ckey = null;
let timeoutType = null;
let ceid = 1;
let captchaID = "";
let captchaBase64 = "";
let reconnect = true;
let CAPI;
let typingState = false;
let typingTimeout = null;
let isSolved = false;
let port = 3001;
let scriptStartTime = Date.now();
const maxRuntimeInMilliseconds = 12 * 60 * 60 * 1000; // 12 hours

if (process.env.CAPTCHA2_API) CAPI = process.env.CAPTCHA2_API;
else CAPI = false;

const spinner = ora({
  hideCursor: false,
  discardStdin: false,
});
const app = express();

colors.setTheme({
  info: "brightBlue",
  obcy: "green",
  bot: "blue",
  message: "grey",
  warn: "yellow",
  end: "red",
});

const ws = new WebSocket(
  "wss://server.6obcy.pl:7001/6eio/?EIO=3&transport=websocket",
  {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:102.0) Gecko/20100101 Firefox/102.0",
    },
    origin: "https://6obcy.org",
  }
);

ws.on("open", function open() {
  onConnected();
});

ws.on("close", function close() {
  SendSystemMessage("Rozłączono z serwerem...");
});

ws.on("message", function incoming(data) {
  console.log("Received message:", data);  // Debugging received messages
  _handleSocketMessage(data);
  const { pingInterval } = parseJson(data);
  if (pingInterval > 0) {
    setInterval(() => ws.send("2"), pingInterval);
  }
});

const _emitSocketEvent = (eventName, eventData) => {
  const eventObj = {
    ev_name: eventName,
    ev_data: eventData,
    ceid: ceid,
  };

  const eventStr = `4${JSON.stringify(eventObj)}`;
  ws.send(eventStr);
};

const disConnect = () => {
  _emitSocketEvent("_distalk", {
    ckey: ckey,
  });
};

const sendMessage = (msg) => {
  _emitSocketEvent("_pmsg", {
    ckey: ckey,
    msg,
    idn: 0,
  });

  SendSystemMessage(colors.bot("Ja: ") + colors.message(msg));

  Typing(false);
  screen.render();
};

const startConversation = () => {
  _emitSocketEvent("_sas", {
    channel: "main",
    myself: {
      sex: 0,
      loc: 0,
    },
    preferences: {
      sex: 0,
      loc: 0,
    },
  });

  spinner.stop();
  input.hide();

  box.setContent("");
  messageList.setContent("");

  isSolved && SendSystemMessage(colors.warn("Szukam rozmówcy...     "));
};

const _handleSocketMessage = (data) => {
  try {
    const msgData = parseJson(data);
    ceid++;

    switch (msgData.ev_name) {
      case "talk_s":
        _handleConversationStart(msgData);
        break;
      case "rmsg":
        _handleStrangerMessage(msgData);
        break;
      case "sdis":
        reconnect && startConversation();
        break;
      case "cn_acc":
        _handleCN(msgData);
        break;
      case "capissol":
        _handleResponseCaptcha(msgData);
        break;
      case "caprecvsas":
        _handleCaptacha(msgData);
        break;
      case "capchresp":
        _handleCaptacha(msgData);
        break;
      case "styp":
        _handleStrangerMessageTyp(msgData.ev_data);
        break;
      case "rtopic":
        _handleRandomQuestion(msgData);
        break;
      case "count":
        _handleCount(msgData.ev_data);
        break;
      default:
        console.warn(`Unknown event type: ${msgData.ev_name}`);
        break;
    }
  } catch (err) {
    console.error("Error handling socket message:", err);
  }
};

const _handleCount = (count) => {
  countBox.setContent(count + " osób online");
  screen.render();
};

const _handleRandomQuestion = (msgData) => {
  SendSystemMessage(colors.end(msgData.ev_data.topic));
};

const _handleStrangerMessageTyp = (typ) => {
  if (typ) {
    box.setContent("Obcy pisze...");
  } else {
    box.setContent("");
  }
  screen.render();
};

const _handleResponseCaptcha = (msgData) => {
  isSolved = msgData.ev_data.success;

  if (captchaBase64.length === 0)
    ReportCaptcha(captchaID, msgData.ev_data.success);

  if (isSolved === false) {
    NewCaptcha();
    const elapsedTime = Date.now() - scriptStartTime;
    if (elapsedTime > maxRuntimeInMilliseconds) {
      console.log("Maximum runtime reached. Exiting...");
      process.exit(0);
    } else {
      console.log("Captcha solving failed. Retrying...");
      // Restart the script by calling the startConversation function
      startConversation();
    }
  }
};

const _handleConversationStart = (msgData) => {
  clearTimeout(timeoutType);
  input.show();
  input.focus();

  _emitSocketEvent("_begacked", {
    ckey: ckey,
  });

  ckey = msgData.ev_data.ckey;
  captchaBase64 = "";

  box.setContent("");
  messageList.setContent("");

  SendSystemMessage(colors.warn("Połączono z obcym...       "));

  process.env.WELCOME && sendMessage(process.env.WELCOME);
};

const _handleStrangerMessage = (msgData) => {
  const uMsg = msgData.ev_data.msg;

  SendSystemMessage(colors.obcy("Obcy: ") + colors.message(uMsg));
};

const _handleCN = (msg) => {
  _emitSocketEvent("_cinfo", {
    hash: msg.ev_data.hash,
    dpa: true,
    caper: true,
  });
  input.hide();

  startConversation();
};

const _handleCaptacha = async (msg) => {
  try {
    // Check if msg.ev_data.tlce is defined
    if (msg.ev_data && msg.ev_data.tlce) {
      let base64 = await msg.ev_data.tlce.data;

      if (CAPI) {
        SendCaptcha(base64);

        setTimeout(() => {
          AskForCaptcha(captchaID);
        }, 10000);
      } else {
        captchaBase64 = base64;
        input.show();
        input.focus();

        box.setContent("Wpisz kod z obrazka z strony która się otworzyła");
        await open("http://localhost:" + port + "/captcha");
      }
    } else {
      console.error('Error: "msg.ev_data.tlce" is undefined.');
      startConversation();
    }
  } catch (error) {
    console.error('Error during captcha handling:', error);
    startConversation();
  }
};

const onConnected = () => {
  input.hide();
  spinner.succeed(`Połączono z serwerem...`);
};

const parseJson = (str) => {
  return JSON.parse(str.slice(str.indexOf("{")));
};

const SendCaptcha = async (base64) => {
  spinner.start("Rozwiązuje captche...");

  await fetch("https://2captcha.com/in.php", {
    body:
      "method=base64&key=" +
      CAPI +
      "&body=" +
      encodeURIComponent(base64) +
      "&regsense=0&min_len=7",
    method: "POST",
  }).then((res) => {
    res.text().then((s) => {
      captchaID = s.substring(3);
    });
  });
};

const AskForCaptcha = (captchaId) => {
  fetch(
    "https://2captcha.com/res.php?key=" +
      CAPI +
      "&id=" +
      captchaId +
      "&action=get"
  ).then((res) => {
    res.text().then((s) => {
      let solved = s.substring(3);

      if (solved === "CHA_NOT_READY") {
        return setTimeout(() => {
          spinner.start("Rozwiązuje captche, jeszcze chwilkę...");

          return AskForCaptcha(captchaID);
        }, 5000); // if not ready wait 10sec and ask again
      }

      SolveCaptcha(solved);
    });
  });
};

const ReportCaptcha = (cID, type) => {
  fetch(
    `http://2captcha.com/res.php?key=${CAPI}&action=${
      type ? "reportgood" : "reportbad"
    }&id=${cID}`
  ).then((res) => {
    res.text().then(() => {
      if (type === false) NewCaptcha();
    });
  });
};

const SolveCaptcha = (solved) => {
  _emitSocketEvent("_capsol", {
    solution: solved,
  });

  startConversation();
};

const Typing = (typing) => {
  typingState = typing;

  _emitSocketEvent("_typ", {
    state: typingState,
    ckey: ckey,
  });
};

// Ustawienia wyświetlania interfejsu
const screen = blessed.screen({
  smartCSR: true,
  autoPadding: true,
  title: "Chat Terminal",
});

const messageList = blessed.box({
  mouse: true,
  keys: true,
  width: "100%",
  height: "85%",
  top: "0%",
  left: 0,
  alwaysScroll: true,
  scrollable: true,
  scrollbar: {
    ch: " ",
    inverse: true,
  },
});

const box = blessed.box({
  mouse: true,
  keys: true,
  width: "100%",
  height: "85%",
  top: "0%",
  left: 0,
});

const input = blessed.textarea({
  top: "90%",
  height: "10%",
  inputOnFocus: true,
  style: {
    fg: "#787878",
    bg: "#454545",
    focus: {
      fg: "#f6f6f6",
      bg: "#353535",
    },
  },
});

screen.append(messageList);
screen.append(box);
screen.append(input);

input.key("enter", function () {
  var message = this.getValue();
  if (message) {
    try {
      if (message === "/topic\n") {
        SendTopic();
      } else if (message === "/dis\n") {
        disConnect();
      } else if (message === "/start\n") {
        reconnect = true;
        startConversation();
      } else if (message === "/stop\n") {
        StopConv();
      } else {
        if (captchaBase64.length === 0) {
          if (message.length > 1) sendMessage(message);
        } else {
          SolveCaptcha(message);
        }
      }
    } catch (_err) {
      console.error("Error processing input:", _err);
    } finally {
      this.clearValue();
      screen.render();
    }
  }
});

screen.render();

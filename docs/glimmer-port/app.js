// "our web-worker"
var worker = new Worker('ww2.js');
// viewportHeight (recalculated on each frame size)
var viewportHeight = 0;
// viewportWidth (recalculated on each frame size)
var viewportWidth = 0;
// render config options
var renderConfig = {
  disableOptional: false,
  isScrolling: undefined,
  totalActions: 0,
  skipNotInVewport: true,
  timePerLastFrame: 0
};

// is debug enabled
var debug = false;
// all nodes cache
var nodesCache = {};

// navigator object mirror
var _navigator = {
  userAgent: navigator.userAgent,
  platform: navigator.platform,
  language: navigator.language,
};

// body style node
var pointerEventsStyleNode = document.body.style['pointer-events'];
// imagine how many milliseconds we can take for each frame
var fpsMs = 16;
// here we store actions timings
var actionTimes = {};
// this is list of async actions
var actionsList = [];
// critical actions list size, if pool rich this size all actions will be applyed
var criticalSize = 1500;
// max size before we increase number of actions per frame
var maxSizeBeforeFlush = 3000;
// flush packet size
var flushSize = 500;
// best fit pool size
var commonPoolSize = fpsMs * 2;
// minimal loop size per action pack
var minLoop = {
  actions: 0,
  time: 20
}
// max loop size per action pack
var maxTime = {
  actions: 0,
  time: 0
}
// avg time per frame
var avgActionTime = 0;

// viewport visiblity cache (frames)
var viewportVisibility = 60;

// value cache for getBoundingClientRect;
var boundingClientRectCache = {};

// var frameId cache for getBoundingClientRect
var boundingClientRectCacheFrame = {};

// frame ID
var frameId = 0;

// viewport size calaculations
function calcViewportSize() {
  viewportHeight = (window.innerHeight || document.documentElement.clientHeight);
  viewportWidth = (window.innerWidth || document.documentElement.clientWidth);
}
//https://gomakethings.com/how-to-test-if-an-element-is-in-the-viewport-with-vanilla-javascript/
function isInViewport(elem) {
  if (!elem) {
    return false;
  }
  var id = elem.id;
  if (!boundingClientRectCacheFrame[id]) {
    boundingClientRectCacheFrame[id] = frameId;
    boundingClientRectCache[id] = true;
  }

  if (viewportVisibility + boundingClientRectCacheFrame[id] > frameId) {
    return boundingClientRectCache[id];
  }

  var bounding = elem.getBoundingClientRect();
  var result = (
    bounding.top >= 0 &&
    bounding.left >= 0 &&
    bounding.bottom <= viewportHeight &&
    bounding.right <= viewportWidth
  );
  boundingClientRectCacheFrame[id] = frameId;
  boundingClientRectCache[id] = result;
  return result;
}
// send list of messages to ww
function sendMessages(items) {
  var args = Array.prototype.slice.call(arguments);
  args.forEach((items) => {
    if (Array.isArray(items)) {
      items.forEach((item) => {
        sendMessage(item);
      });
    } else {
      sendMessage(items);
    }
  })
}
// send single message to ww
function sendMessage(data) {
  log('sendMessage', data);
  worker.postMessage(data);
}

worker.onmessage = (e) => {
  actionScheduler(e.data);
};

// Listen for scroll events
window.addEventListener('scroll', (event) => {

  if (pointerEventsStyleNode !== 'none') {
    pointerEventsStyleNode = 'none';
  }

  window.clearTimeout(renderConfig.isScrolling);

  renderConfig.isScrolling = setTimeout(() => {
    pointerEventsStyleNode = 'auto';
    renderConfig.isScrolling = false;
  }, 66);

}, false);

// app init procedure
sendMessages(

  // {
  // uid: '_setNavigator',
  // navigator: _navigator
  // },{
  // uid: 'set_modernizr_custom',
  // modernizr_custom: {}
  // },
  {
    uid: '_setLocation',
    location: {
      hash: window.location.hash,
      href: window.location.href,
      port: window.location.port,
      host: window.location.host,
      origin: window.location.origin,
      hostname: window.location.hostname,
      pathname: window.location.pathname,
      protocol: window.location.protocol,
      search: window.location.search,
      state: window.history.state,
    }
  },
  // ,{
  // uid: '_setScreen',
  // screen: {
  // width: window.screen.width,
  // height: window.screen.height,
  // }
  // },

  {
    uid: 'init',
  });

// window.onfocus = () => {
// 	sendMessage({
// 		uid: '_onFocus',
// 	});
// }
// window.onhashchange = () => {
// 	sendMessage({
// 		uid: '_onhashchange',
// 	});
// }
// window.onpopstate = () => {
// 	sendMessage({
// 		uid: '_onpopstate',
// 	});
// }
// window.onblur = () => {
// 	sendMessage({
// 		uid: '_onBlur'
// 	});
// }

// check action - should we skipt it from render?
function shouldSkip(data) {
  // if (data.action !== 'createNode' && data.id) {
  // if (!nodesCache[data.id]) {
  // return true;
  // }
  // }
  if (data.length || !data.optional) {
    return false;
  }
  if (renderConfig.disableOptional && data.optional) {
    return true;
  }
  if ((renderConfig.isScrolling || document.hidden) && data.optional) {
    return true;
  }
  if (data.optional && actionsList.length > criticalSize / 2) {
    return true;
  }
  if (renderConfig.timePerLastFrame > (fpsMs + 0.2) && data.optional) {
    renderConfig.timePerLastFrame -= getTimePerAction(data.action);
    return true;
  } else {
    return false;
  }
}
// set time, required for one action
function setTimePerAction(action, time) {
  if (typeof action === 'string' && time > 0) {
    actionTimes[action] = time + 0.02;
  }
}
// get time, required for one action
function getTimePerAction(action) {
  if (typeof action !== 'string') {
    return 1;
  }
  if (!actionTimes[action]) {
    actionTimes[action] = 0.5;
  }
  return actionTimes[action];
}
// sorting DOM actions to get maximum painting performance
function smartBatchSort(actions) {
  const priorityActionsMap = {
    'createNode': 1,
    'setAttribute': 2,
    'addEventListener': 3,
    'appendChild': 4,
    'bodyAppendChild': 5,
    'removeNode': 6
  };
  return actions.sort((a, b) => {
    return priorityActionsMap[a.action] - priorityActionsMap[b.action];
  });
  // priority - create, style, append
}

// do something with performance results
function performanceFeedback(delta, actions) {
  calcAvgActionTime();
  renderConfig.timePerLastFrame = delta;
  renderConfig.totalActions = actions;
}

// put resived actions to dom actions list

let pushedBackActions = 0;

function actionScheduler(action) {
  if (!shouldSkip(action)) {
    actionsList.push(action);
  } else {
    skip(action);
  }
}

// clear all existing actions
function clearActions() {
  actionsList = [];
}

// get some render and evaluate priority for actions
function prioritySort(a, b) {
  if (a.priority && !b.priority) {
    return -1;
  }
  if (!a.priority && b.priority) {
    return 1;
  }
  if (a.priority && b.priority) {
    return b.priority - a.priority;
  }
  if (a.optional && !b.optional) {
    return 1;
  }
  if (!a.optional && b.optional) {
    return -1;
  }
  if (a.length && !b.length) {
    return -1;
  }
  if (!a.length && b.length) {
    return 1;
  }
  return a.uid - b.uid;
}

// get actions, that should be executed at requested frame
function getActionsForLoop() {
  var optimalCap = getOptimalActionsCap();
  actionsList = actionsList.sort(prioritySort);
  var actions = actionsList.splice(0, optimalCap);
  return actions;
}

// avarage action time calculation
function calcAvgActionTime() {
  if (!maxTime.actions) {
    return 1;
  }
  avgActionTime = maxTime.time / maxTime.actions;
}

// funky logic to get optimal actions count for current frame
function getOptimalActionsCap() {

  var optimalCandidate = Math.round(fpsMs / (renderConfig.timePerLastFrame / renderConfig.totalActions));

  if (isNaN(optimalCandidate) || !isFinite(optimalCandidate)) {
    optimalCandidate = 0;
  }

  var optimalCap = Math.round((fpsMs * 3) / (avgActionTime || 1) || 10);

  if (optimalCap > 1) {
    optimalCap--;
  }
  var maxLength = actionsList.length;
  if (maxLength - 1 < optimalCap) {
    optimalCap = maxLength;
  }
  if (maxLength >= maxSizeBeforeFlush) {
    optimalCap = flushSize;
  }
  if (maxLength > criticalSize) {
    return criticalSize;
  }
  if (optimalCap < optimalCandidate && flushSize > optimalCap) {
    if (optimalCandidate <= maxLength) {
      optimalCap = optimalCandidate;
    }
  }
  if (maxLength > commonPoolSize && optimalCap < commonPoolSize) {
    optimalCap = commonPoolSize;
  }

  return optimalCap;
}

// return an callback for finished action
function skip(action, result) {
  if (action.cb && action.uid) {
    var responce = result || {
      skip: true
    }
    responce.uid = action.uid;
    log('cb', action, responce);
    sendMessage(responce);
  }
}

// if action can't fit in 16ms range push it back
function pushBackAction(action) {
  actionsList.unshift(action);
}

function pushBackActions(actions) {
  actions.forEach(action => {
    pushBackAction(action);
  });
}


// main render thread
function actionLoop(startMs) {
  frameId++;
  calcViewportSize();
  var newActions = getActionsForLoop();
  log('actions.length', newActions.length);
  var totalActions = newActions.length;
  const totalActionsSize = totalActions;
  pushedBackActions = 0;
  for (let i = 0; i < newActions.length; i++) {
    let action = newActions[i];
    if (totalActionsSize < flushSize && performance.now() - startMs > (fpsMs + 1)) {
      let skipSize = newActions.length - i;
      totalActions -= skipSize;
      pushedBackActions += skipSize;
      log('pushBackAction', performance.now() - startMs);
      pushBackActions(newActions.splice(i, skipSize));
      break;
    }
    performAction(action, (result) => {
      if (result.skip || (result.result && result.skip)) {
        totalActions--;
      }
      if (result.result && result.result.timeShift) {
        totalActions--;
        startMs -= result.timeShift;
      }
      // console.log('skip',action,result);
      skip(action, result);
    });
  }

  var feedbackDelta = performance.now() - startMs;

  if (feedbackDelta < minLoop.time && totalActions > 1) {
    minLoop.time = feedbackDelta;
    minLoop.actions = totalActions
  }

  if (feedbackDelta > maxTime.time && totalActions > 1) {
    maxTime.time = feedbackDelta;
    maxTime.actions = totalActions
  }

  var delta = fpsMs - feedbackDelta;
  if (delta < 0) {
    delta = 5;
  }
  if (totalActions) {
    performanceFeedback(feedbackDelta, totalActions);
  }
  requestAnimationFrame(actionLoop);
}

// simple logging function
function log() {
  if (!debug) {
    return;
  }
  console.log.apply(this, Array.prototype.slice.call(arguments));
}

// node cache
function getNode(id, data) {
  if (id === 'window') {
    return window;
  }
  if (id === 'document') {
    return document;
  }
  if (!nodesCache[id]) {
    nodesCache[id] = document.getElementById(id);
  }
  if (!nodesCache[id] && data && data.selector) {
    return document.querySelector(data.selector);
  }
  return nodesCache[id];
}

function customCreateComment(data) {
  if (getNode(data.id)) {
    return;
  }

  nodesCache[data.id] = document.createComment(data.textContent);
}

// DOM action createElement
function createNode(data) {

  // console.log('createNode '+data.id,data);


  if (getNode(data.id)) {
    // console.log('node exists', data.id);
    return;
  }

  if (data.tag === 'HTML') {
    function createNodeAlias(id, newId) {
      // console.log('createNodeAlias',id,newId);
      nodesCache[newId] = nodesCache[id];
    }
    nodesCache[data.id] = document.parentNode;

    return;
  }

  if (data.tag === 'BODY') {
    nodesCache[data.id] = document.getElementsByTagName('BODY')[0];
    return;
  }


  if (data.tag.charAt(0) === '#') {
    nodesCache[data.id] = document.createTextNode(data.textContent);
    return;
  }



  var node = null;

  if (['svg', 'path'].indexOf(data.tag.toLowerCase()) > -1) {
    node = document.createElementNS('http://www.w3.org/2000/svg', data.tag.toLowerCase());
    console.log(node, data.tag);
  } else {
    node = document.createElement(data.tag);
  }
  if (data.tag.toLowerCase() === 'canvas') {
    node.style.display = 'none';
  }
  node.id = data.id
  if (data.href) {
    node.href = data.href;
  }
  if (data.textContent) {
    console.log('textContent', data.textContent);
    node.textContent = data.textContent;
  }
  if (data.target) {
    node.target = data.target;
  }
  if (data.title) {
    node.title = data.title;
  }
  nodesCache[data.id] = node;
}

// DOM action appendChild
function appendChild(data) {

  var parent = getNode(data.id, data);
  var children = getNode(data.childrenId, data);
  // if (data.id === 'body-node') {
  // console.log('appendChild',data,parent,children);
  // }
  if (!parent) {

    parent = document.body;

    console.log(data);
    // return;
  }
  if (!children) {
    console.log('appendChild: unable to find children', data);
    return;
  }
  parent.appendChild(children);
}

// DOM action el.innerHTML
function setHTML(data) {
  log('setHTML', data);
  var node = getNode(data.id);
  if (node) {
    node.innerHTML = data.html;
  }
  // if (getNode(data.id).innerHTML !== data.html) {
  // getNode(data.id).
  // }

  return;
}

//
function getInnerHTML(data) {
  log('getInnerHTML', data);
  return; getNode(data.id, data).innerHTML;
}

// DOM action el.innerHTML
function appendHTML(data) {
  log('appendHTML', data);
  getNode(data.id, data).innerHTML = getNode(data.id, data).innerHTML + data.html;
  return;
}

// DOM action setTextContent
function setTextContent(data) {
  return getNode(data.id).textContent = data.textContent;
}

function createNodeAlias(id, newId) {
  // console.log('createNodeAlias',id,newId);
  nodesCache[newId] = nodesCache[id];
}

// DOM action setAttribute
function removeAttribute(data) {
  var node = getNode(data.id, data);
  if (node) {
    node.removeAttribute(data.attribute);
  }
}

function setAttribute(data) {
  var node = getNode(data.id, data);
  if (!node) {
    console.log('setAttribute', data);
    return;
  }
  if (data.attribute === 'id') {
    createNodeAlias(node.id, data.value);
  }
  node.setAttribute(data.attribute, data.value);

}

// DOM action setStyle
function setStyle(data) {
  console.log('setStyle', data);
  var node = getNode(data.id, data);
  if (!node) {
    return;
  }
  if (data.optional && renderConfig.skipNotInVewport) {
    if (!isInViewport(node)) {
      log('!isInViewport', data);
      return {
        skip: true
      };
    }

  }
  node.style[data.attribute] = data.value;
}
function setProperty(data) {
  var node = getNode(data.id);
  if (!node) {
    return;
  }
  node[data.property] = data.value;
}
// DOM action appendChild to head node
function headAppendChild(data) {
  var node = getNode(data.id);
  node && document.head.appendChild(node);
}
// DOM action appendChild to body node
function bodyAppendChild(data) {
  var node = getNode(data.id);
  node && document.body.appendChild(node);
}
// DOM action removeChild
function removeNode(data) {
  removeEventListeners(data);
  var node = getNode(data.id);
  if (!node) {
    log('removeNode', data);
    return;
  }
  delete nodesCache[data.id];
  if (node.parentNode) {
    node.parentNode.removeChild(node);
  } else {
    node.remove();
  }


}
// DOM action classList.remove
function removeClass(data) {
  return getNode(data.id).classList.remove(data.class);
}

function styleToObject(styleNode) {
  var obj = {};
  for (var i = 0; i < styleNode.length; i++) {
    obj[styleNode[i]] = styleNode.getPropertyValue(styleNode[i]);
  }
  return obj;
}

// DOM action getElementById
function customGetElementById(data) {
  return getNodeData(data);
}
// DOM action getElementById
function getNodeData(data) {
  var node = getNode(data.id);
  if (!node) {
    return {};
  }
  return {
    clientWidth: node.clientWidth || 0,
    clientHeight: node.clientHeight || 0,
    scrollWidth: node.scrollWidth || 0,
    scrollHeight: node.scrollHeight || 0,
    offsetWidth: node.offsetWidth || 0,
    offsetHeight: node.offsetHeight || 0,
    scrollTop: node.scrollTop || 0,
    scrollLeft: node.scrollLeft || 0,
    style: styleToObject(node.style),
    innerWidth: node.innerWidth || 0,
    innerHeight: node.innerHeight || 0,
    scrollY: node.scrollY || 0
  };
}
// event-listeners remover
function removeEventListeners(data) {

}
// focus element
function focusEl(data) {
  if (data.id) {
    getNode(data.id).focus();
  } else {
    window.focus();
  }
}
// DOM action classList.add
function addClass(data) {
  return getNode(data.id).classList.add(data.class);
}
// DOM action getStyleValue
function getStyleValue(data) {
  return getNode(data.id).style[data.style];
}
// Event to Object transormation (to pass it to ww)
function eventToObject(e) {

  // console.log(e.target.id);
  // console.log('eventToObject',e);
  if (e.target && e.target.tagName && e.target.tagName.toLowerCase() === 'a') {
    e.preventDefault();
  }
  if (e.currentTarget && e.currentTarget.tagName && e.currentTarget.tagName.toLowerCase() === 'a') {
    e.preventDefault();
  }

  return {
    altKey: e.altKey,
    bubbles: e.bubbles,
    button: e.button,
    buttons: e.buttons,
    keyCode: e.keyCode || null,
    cancelBubble: e.cancelBubble,
    cancelable: e.cancelable,
    clientX: e.clientX,
    clientY: e.clientY,
    composed: e.composed,
    ctrlKey: e.ctrlKey,
    currentTarget: e.currentTarget ? e.currentTarget.id : null,
    relatedTarget: e.relatedTarget ? e.relatedTarget.id : null,
    defaultPrevented: e.defaultPrevented,
    detail: e.detail,
    eventPhase: e.eventPhase,
    fromElement: e.fromElement ? e.fromElement.id : null,
    isTrusted: e.isTrusted,
    layerX: e.layerX,
    layerY: e.layerY,
    metaKey: e.metaKey,
    movementX: e.movementX,
    movementY: e.movementY,
    offsetX: e.offsetX,
    offsetY: e.offsetY,
    pageX: e.pageX,
    pageY: e.pageY,
    returnValue: e.returnValue,
    screenX: e.screenX,
    screenY: e.screenY,
    shiftKey: e.shiftKey,
    path: [],
    region: e.region || null,
    srcElement: e.srcElement ? e.srcElement.id : null,
    target: e.target ? e.target.id : null,
    type: e.type || undefined,
    timeStamp: e.timeStamp,
    toElement: e.toElement ? e.toElement.id : null,
    which: e.which,
    x: e.x,
    y: e.y
  };
}
// Alert implementation
function customAlert(data) {
  var blockStart = performance.now();
  alert(data.text);
  return {
    timeShift: performance.now() - blockStart
  }
}
// addEventListener implementation
function customAddEventListener(data) {
  log('addEventListener', data);
  var eventCallback = function (domEvent) {
    var e = eventToObject(domEvent);
    e.uid = `_${data.uid}_${data.name}`;
    sendMessage(e);
  };
  var node = getNode(data.id, data);
  if (node) {
    node.addEventListener(data.name, eventCallback.bind(data), false);
  } else {
    console.log('addEventListener', data);
  }

  return {};
}


function loadImage(data) {
  var img = new Image();
  img.onload = function () {
    sendMessage({
      uid: 'onload_' + data.id,
      src: img.src,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    });
  }
  img.onerror = function () {
    sendMessage({
      uid: 'onerror_' + data.id
    });
  }
  if (data.src.indexOf('//') == -1) {
    data.src = 'https://tv.start.ru/' + data.src;
  }
  img.src = data.src;
}
function customInsertBefore(data) {
  // action:'insertBefore',id:this.id,newId: newElement.id, refId: referenceElement.id})

  if (!data.newId) {
    return;
  }

  var root = getNode(data.id);
  if (root) {
    var newEl = getNode(data.newId);
    if (newEl) {
      if (data.refId) {
        var refEl = getNode(data.refId);
        if (refEl) {
          root.insertBefore(newEl, refEl);
        }
      } else {
        root.insertBefore(newEl, null);
      }

    }
  }
}
function styleSheetAddRule(data) {
  var node = getNode(data.id, data);
  var name = data.selector;
  var rules = data.rule;

  if (!(node.sheet || {}).insertRule) {
    var sheet = (node.styleSheet || node.sheet)
    sheet.addRule(name, rules)
  } else {
    var sheet = node.sheet;
    sheet.insertRule(name + '{' + rules + '}', sheet.cssRules.length);
  }

  // node.styleSheet.addRule(data.selector,data.rule);
}

function setClassName(data) {

  var node = getNode(data.id, data);
  if (!node) {
    return;
  }

  node.className = data.name;
}

function scrollTo() {
  window.scrollTo(0, 0);
}

function customPushState(data) {
  //data.url
  window.history.pushState(data.state, data.title, data.url);
}
function customReplaceState(data) {
  //data.url
  window.history.replaceState(data.state, data.title, data.url);
}
// single action evaluation logic
function evaluateAction(data, callback) {
  log('evaluateAction', data);
  if (shouldSkip(data)) {
    log('skip', data);
    return callback({ skip: true });
  }
  var start = performance.now();

  var actions = {
    'createNode': createNode,
    'createComment': customCreateComment,
    'focus': focusEl,
    'setHTML': setHTML,
    'insertBefore': customInsertBefore,
    'appendHTML': appendHTML,
    'getInnerHTML': getInnerHTML,
    'getStyleValue': getStyleValue,
    'pushState': customPushState,
    'replaceState': customReplaceState,
    'setTextContent': setTextContent,
    'styleSheetAddRule': styleSheetAddRule,
    'alert': customAlert,
    'scrollTo': scrollTo,
    'addEventListener': customAddEventListener,
    'headAppendChild': headAppendChild,
    'bodyAppendChild': bodyAppendChild,
    'appendChild': appendChild,
    'setAttribute': setAttribute,
    'removeAttribute': removeAttribute,
    'setStyle': setStyle,
    'setProperty': setProperty,
    'removeNode': removeNode,
    'loadImage': loadImage,
    'setClassName': setClassName,
    'getElementById': customGetElementById,
    'addClass': addClass,
    'removeClass': removeClass
  }

  if (data.action) {
    callback({ result: actions[data.action](data) });
    setTimePerAction(data.action, performance.now() - start);
    log('action', data);
  } else {
    callback({});
    log('no-action', data);
  }
}
// action pack handle logic
function performAction(data, callback) {

  var result = [];
  if (data.length) {
    smartBatchSort(data).forEach(adata => {
      evaluateAction(adata, (item) => {
        result.push(item);
        if (result.length === data.length) {
          callback(result);
        }
      });
    });
  } else {
    evaluateAction(data, callback);
  }

}
// start the world
requestAnimationFrame(actionLoop);

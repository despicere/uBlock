/*******************************************************************************

    µBlock - a Chromium browser extension to block requests.
    Copyright (C) 2014 Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

/* global chrome */

// Injected into content pages

/******************************************************************************/
/******************************************************************************/

// https://github.com/gorhill/httpswitchboard/issues/345

var uBlockMessaging = (function(name){
    var port = null;
    var requestId = 1;
    var requestIdToCallbackMap = {};
    var listenCallback = null;

    var onPortMessage = function(details) {
        if ( typeof details.id !== 'number' ) {
            return;
        }
        // Announcement?
        if ( details.id < 0 ) {
            if ( listenCallback ) {
                listenCallback(details.msg);
            }
            return;
        }
        var callback = requestIdToCallbackMap[details.id];
        if ( !callback ) {
            return;
        }
        // Must be removed before calling client to be sure to not execute
        // callback again if the client stops the messaging service.
        delete requestIdToCallbackMap[details.id];
        callback(details.msg);
    };

    var start = function(name) {
        port = chrome.runtime.connect({ name: name });
        port.onMessage.addListener(onPortMessage);

        // https://github.com/gorhill/uBlock/issues/193
        port.onDisconnect.addListener(stop);
    };

    var stop = function() {
        listenCallback = null;
        port.disconnect();
        port = null;
        flushCallbacks();
    };

    if ( typeof name === 'string' && name !== '' ) {
        start(name);
    }

    var ask = function(msg, callback) {
        if ( port === null ) {
            if ( typeof callback === 'function' ) {
                callback();
            }
            return;
        }
        if ( callback === undefined ) {
            tell(msg);
            return;
        }
        var id = requestId++;
        port.postMessage({ id: id, msg: msg });
        requestIdToCallbackMap[id] = callback;
    };

    var tell = function(msg) {
        if ( port !== null ) {
            port.postMessage({ id: 0, msg: msg });
        }
    };

    var listen = function(callback) {
        listenCallback = callback;
    };

    var flushCallbacks = function() {
        var callback;
        for ( var id in requestIdToCallbackMap ) {
            if ( requestIdToCallbackMap.hasOwnProperty(id) === false ) {
                continue;
            }
            callback = requestIdToCallbackMap[id];
            if ( !callback ) {
                continue;
            }
            // Must be removed before calling client to be sure to not execute
            // callback again if the client stops the messaging service.
            delete requestIdToCallbackMap[id];
            callback();
        }
    };

    return {
        start: start,
        stop: stop,
        ask: ask,
        tell: tell,
        listen: listen
    };
})('contentscript-end.js');

/******************************************************************************/
/******************************************************************************/

// ABP cosmetic filters

(function() {
    var messaging = uBlockMessaging;
    var queriedSelectors = {};
    var injectedSelectors = {};
    var classSelectors = null;
    var idSelectors = null;
    var highGenerics = null;
    var contextNodes = [document];
    var nullArray = { push: function(){} };

    var domLoaded = function() {
        var style = document.getElementById('ublock-preload-1ae7a5f130fc79b4fdb8a4272d9426b5');
        if ( style ) {
            // https://github.com/gorhill/uBlock/issues/14
            // Treat any existing domain-specific exception selectors as if
            // they had been injected already.
            var selectors, i;
            var exceptions = style.getAttribute('data-ublock-exceptions');
            if ( exceptions ) {
                selectors = JSON.parse(exceptions);
                i = selectors.length;
                while ( i-- ) {
                    injectedSelectors[selectors[i]] = true;
                }
            }
            // Avoid re-injecting already injected CSS rules.
            selectors = selectorsFromStyles(style);
            i = selectors.length;
            while ( i-- ) {
                injectedSelectors[selectors[i]] = true;
            }
            // https://github.com/gorhill/uBlock/issues/158
            // Ensure injected styles are enforced
            hideElements(selectors.join(','));
        }
        idsFromNodeList(document.querySelectorAll('[id]'));
        classesFromNodeList(document.querySelectorAll('[class]'));
        retrieveGenericSelectors();
    };

    var selectorsFromStyles = function(styleRef) {
        var selectors = [];
        var styles = typeof styleRef === 'string' ?
            document.querySelectorAll(styleRef):
            [styleRef];
        var i = styles.length;
        var style, subset, lastSelector, pos;
        while ( i-- ) {
            style = styles[i];
            subset = style.textContent.split(',\n');
            lastSelector = subset.pop();
            if ( lastSelector ) {
                pos = lastSelector.indexOf('\n');
                if ( pos !== -1 ) {
                    subset.push(lastSelector.slice(0, pos));
                }
            }
            selectors = selectors.concat(subset);
        }
        return selectors;
    };

    var retrieveGenericSelectors = function() {
        var selectors = classSelectors !== null ? Object.keys(classSelectors) : [];
        if ( idSelectors !== null ) {
            selectors = selectors.concat(idSelectors);
        }
        if ( selectors.length > 0 || highGenerics === null ) {
            //console.log('µBlock> ABP cosmetic filters: retrieving CSS rules using %d selectors', selectors.length);
            messaging.ask({
                    what: 'retrieveGenericCosmeticSelectors',
                    pageURL: window.location.href,
                    selectors: selectors,
                    highGenerics: highGenerics === null
                },
                retrieveHandler
            );
        } else {
            retrieveHandler(null);
        }
        idSelectors = null;
        classSelectors = null;
    };

    var retrieveHandler = function(selectors) {
        //console.debug('µBlock> contextNodes = %o', contextNodes);
        if ( selectors && selectors.highGenerics ) {
            highGenerics = selectors.highGenerics;
        }
        if ( selectors && selectors.donthide.length ) {
            processLowGenerics(selectors.donthide, nullArray);
        }
        if ( highGenerics ) {
            if ( highGenerics.donthideLowCount ) {
                processHighLowGenerics(highGenerics.donthideLow, nullArray);
            }
            if ( highGenerics.donthideMediumCount ) {
                processHighMediumGenerics(highGenerics.donthideMedium, nullArray);
            }
        }
        // No such thing as high-high generic exceptions.
        //if ( highGenerics.donthideHighCount ) {
        //    processHighHighGenerics(document, highGenerics.donthideHigh, nullArray);
        //}
        var hideSelectors = [];
        if ( selectors && selectors.hide.length ) {
            processLowGenerics(selectors.hide, hideSelectors);
        }
        if ( highGenerics ) {
            if ( highGenerics.hideLowCount ) {
                processHighLowGenerics(highGenerics.hideLow, hideSelectors);
            }
            if ( highGenerics.hideMediumCount ) {
                processHighMediumGenerics(highGenerics.hideMedium, hideSelectors);
            }
            if ( highGenerics.hideHighCount ) {
                processHighHighGenericsAsync();
            }
        }
        if ( hideSelectors.length ) {
            addStyleTag(hideSelectors);
        }
        contextNodes.length = 0;
    };

    // Ensure elements matching a set of selectors are visually removed 
    // from the page, by:
    // - Modifying the style property on the elements themselves
    // - Injecting a style tag

    var addStyleTag = function(selectors) {
        hideElements(selectors);
        var style = document.createElement('style');
        style.setAttribute('class', 'ublock-postload-1ae7a5f130fc79b4fdb8a4272d9426b5');
        // The linefeed before the style block is very important: do no remove!
        style.appendChild(document.createTextNode(selectors.join(',\n') + '\n{display:none !important;}'));
        var parent = document.body || document.documentElement;
        if ( parent ) {
            parent.appendChild(style);
        }
        messaging.tell({
            what: 'injectedSelectors',
            type: 'cosmetic',
            hostname: window.location.hostname,
            selectors: selectors
        });
        //console.debug('µBlock> generic cosmetic filters: injecting %d CSS rules:', selectors.length, text);
    };

    var hideElements = function(selectors) {
        // https://github.com/gorhill/uBlock/issues/207
        // Do not call querySelectorAll() using invalid CSS selectors
        if ( selectors.length === 0 ) {
            return;
        }
        if ( document.body === null ) {
            return;
        }
        // https://github.com/gorhill/uBlock/issues/158
        // Using CSSStyleDeclaration.setProperty is more reliable
        var elems = document.querySelectorAll(selectors);
        var i = elems.length;
        while ( i-- ) {
            elems[i].style.setProperty('display', 'none', 'important');
        }
    };

    // Extract and return the staged nodes which (may) match the selectors.

    var selectNodes = function(selector) {
        var targetNodes = [];
        var i = contextNodes.length;
        var node, nodeList, j;
        var doc = document;
        while ( i-- ) {
            node = contextNodes[i];
            if ( node === doc ) {
                return doc.querySelectorAll(selector);
            }
            targetNodes.push(node);
            nodeList = node.querySelectorAll(selector);
            j = nodeList.length;
            while ( j-- ) {
                targetNodes.push(nodeList[j]);
            }
        }
        return targetNodes;
    };

    // Low generics:
    // - [id]
    // - [class]

    var processLowGenerics = function(generics, out) {
        var i = generics.length;
        var selector;
        while ( i-- ) {
            selector = generics[i];
            if ( injectedSelectors[selector] !== undefined ) {
                continue;
            }
            injectedSelectors[selector] = true;
            out.push(selector);
        }
    };

    // High-low generics:
    // - [alt="..."]
    // - [title="..."]

    var processHighLowGenerics = function(generics, out) {
        var attrs = ['title', 'alt'];
        var attr, attrValue, nodeList, iNode, node;
        var selector;
        while ( attr = attrs.pop() ) {
            nodeList = selectNodes('[' + attr + ']');
            iNode = nodeList.length;
            while ( iNode-- ) {
                node = nodeList[iNode];
                attrValue = node.getAttribute(attr);
                if ( !attrValue ) { continue; }
                selector = '[' + attr + '="' + attrValue + '"]';
                if ( generics[selector] ) {
                    if ( injectedSelectors[selector] === undefined ) {
                        injectedSelectors[selector] = true;
                        out.push(selector);
                    }
                }
                selector = node.tagName.toLowerCase() + selector;
                if ( generics[selector] ) {
                    if ( injectedSelectors[selector] === undefined ) {
                        injectedSelectors[selector] = true;
                        out.push(selector);
                    }
                }
            }
        }
    };

    // High-medium generics:
    // - [href^="http"]

    var processHighMediumGenerics = function(generics, out) {
        var nodeList = selectNodes('a[href^="http"]');
        var iNode = nodeList.length;
        var node, href, pos, hash, selectors, selector, iSelector;
        while ( iNode-- ) {
            node = nodeList[iNode];
            href = node.getAttribute('href');
            if ( !href ) { continue; }
            pos = href.indexOf('://');
            if ( pos === -1 ) { continue; }
            hash = href.slice(pos + 3, pos + 11);
            selectors = generics[hash];
            if ( selectors === undefined ) { continue; }
            selectors = selectors.split(',\n');
            iSelector = selectors.length;
            while ( iSelector-- ) {
                selector = selectors[iSelector];
                if ( injectedSelectors[selector] === undefined ) {
                    injectedSelectors[selector] = true;
                    out.push(selector);
                }
            }
        }
    };

    // High-high generics are *very costly* to process, so we will coalesce 
    // requests to process high-high generics into as few requests as possible.
    // The gain is *significant* on bloated pages.

    var processHighHighGenericsTimer = null;

    var processHighHighGenerics = function() {
        processHighHighGenericsTimer = null;
        if ( injectedSelectors['{{highHighGenerics}}'] !== undefined ) { return; }
        if ( document.querySelector(highGenerics.hideHigh) === null ) { return; }
        injectedSelectors['{{highHighGenerics}}'] = true;
        // We need to filter out possible exception cosmetic filters from 
        // high-high generics selectors.
        var selectors = highGenerics.hideHigh.split(',\n');
        var i = selectors.length;
        var selector;
        while ( i-- ) {
            selector = selectors[i];
            if ( injectedSelectors.hasOwnProperty(selector) ) {
                selectors.splice(i, 1);
            } else {
                injectedSelectors[selector] = true;
            }
        }
        if ( selectors.length !== 0 ) {
            addStyleTag(selectors);
        }
    };

    var processHighHighGenericsAsync = function() {
        if ( processHighHighGenericsTimer !== null ) {
            clearTimeout(processHighHighGenericsTimer);
        }
        processHighHighGenericsTimer = setTimeout(processHighHighGenerics, 300);
    };

    // Extract all ids: these will be passed to the cosmetic filtering
    // engine, and in return we will obtain only the relevant CSS selectors.

    var idsFromNodeList = function(nodes) {
        if ( !nodes || !nodes.length ) {
            return;
        }
        if ( idSelectors === null ) {
            idSelectors = [];
        }
        var qq = queriedSelectors;
        var ii = idSelectors;
        var node, v;
        var i = nodes.length;
        while ( i-- ) {
            node = nodes[i];
            if ( node.nodeType !== 1 ) { continue; }
            // id
            v = nodes[i].id;
            if ( typeof v !== 'string' ) { continue; }
            v = v.trim();
            if ( v === '' ) { continue; }
            v = '#' + v;
            if ( qq[v] ) { continue; }
            ii.push(v);
            qq[v] = true;
        }
    };

    // Extract all classes: these will be passed to the cosmetic filtering
    // engine, and in return we will obtain only the relevant CSS selectors.

    var classesFromNodeList = function(nodes) {
        if ( !nodes || !nodes.length ) {
            return;
        }
        if ( classSelectors === null ) {
            classSelectors = {};
        }
        var qq = queriedSelectors;
        var cc = classSelectors;
        var node, v, vv, j;
        var i = nodes.length;
        while ( i-- ) {
            node = nodes[i];
            if ( node.nodeType !== 1 ) { continue; }
            // class
            v = nodes[i].className;
            // it could be an SVGAnimatedString...
            if ( typeof v !== 'string' ) { continue; }
            v = v.trim();
            if ( v === '' ) { continue; }
            // one class
            if ( v.indexOf(' ') < 0 ) {
                v = '.' + v;
                if ( qq[v] ) { continue; }
                cc[v] = true;
                qq[v] = true;
                continue;
            }
            // many classes
            vv = v.trim().split(' ');
            j = vv.length;
            while ( j-- ) {
                v = vv[j].trim();
                if ( v === '' ) { continue; }
                v = '.' + v;
                if ( qq[v] ) { continue; }
                cc[v] = true;
                qq[v] = true;
            }
        }
    };

    // Start cosmetic filtering.

    domLoaded();

    // Below this point is the code which takes care to observe changes in
    // the page and to add if needed relevant CSS rules as a result of the
    // changes.

    // Observe changes in the DOM only if...
    // - there is a document.body
    // - there is at least one `script` tag
    if ( !document.body || !document.querySelector('script') ) {
        return;
    }

    var ignoreTags = {
        'link': true,
        'LINK': true,
        'script': true,
        'SCRIPT': true,
        'style': true,
        'STYLE': true
    };

    // Added node lists will be cumulated here before being processed
    var addedNodeLists = [];
    var addedNodeListsTimer = null;

    var mutationObservedHandler = function() {
        var nodeList, iNode, node;
        while ( nodeList = addedNodeLists.pop() ) {
            iNode = nodeList.length;
            while ( iNode-- ) {
                node = nodeList[iNode];
                if ( node.nodeType !== 1 ) {
                    continue;
                }
                if ( ignoreTags.hasOwnProperty(node.tagName) ) {
                    continue;
                }
                contextNodes.push(node);
            }
        }
        addedNodeListsTimer = null;
        if ( contextNodes.length !== 0 ) {
            idsFromNodeList(selectNodes('[id]'));
            classesFromNodeList(selectNodes('[class]'));
            retrieveGenericSelectors();
        }
    };

    // https://github.com/gorhill/uBlock/issues/205
    // Do not handle added node directly from within mutation observer.
    var treeMutationObservedHandlerAsync = function(mutations) {
        var iMutation = mutations.length;
        var nodeList;
        while ( iMutation-- ) {
            nodeList = mutations[iMutation].addedNodes;
            if ( nodeList.length !== 0 ) {
                addedNodeLists.push(nodeList);
            }
        }
        if ( addedNodeListsTimer === null ) {
            // I arbitrarily chose 50 ms for now:
            // I have to compromise between the overhead of processing too few 
            // nodes too often and the delay of many nodes less often.
            addedNodeListsTimer = setTimeout(mutationObservedHandler, 75);
        }
    };

    // https://github.com/gorhill/httpswitchboard/issues/176
    var treeObserver = new MutationObserver(treeMutationObservedHandlerAsync);
    treeObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
})();

/******************************************************************************/
/******************************************************************************/

// Permanent

(function() {
    var messaging = uBlockMessaging;

    // Listeners to mop up whatever is otherwise missed:
    // - Future requests not blocked yet
    // - Elements dynamically added to the page
    // - Elements which resource URL changes

    var loadedElements = {
        'iframe': 'src'
    };

    var failedElements = {
        'img': 'src',
        'input': 'src',
        'object': 'data'
    };

    var onResource = function(target, dict) {
        if ( !target ) {
            return;
        }
        var tagName = target.tagName.toLowerCase();
        var prop = dict[tagName];
        if ( prop === undefined ) {
            return;
        }
        var src = target[prop];
        if ( typeof src !== 'string' || src === '' ) {
            return;
        }
        if ( src.slice(0, 4) !== 'http' ) {
            return;
        }

        // https://github.com/gorhill/uBlock/issues/174
        // Do not remove fragment from src URL

        var onAnswerReceived = function(details) {
            if ( typeof details !== 'object' || details === null ) {
                return;
            }
            // If `!important` is not there, going back using history will
            // likely cause the hidden element to re-appear.
            if ( details.collapse ) {
                if ( target.parentNode ) {
                    target.parentNode.removeChild(target);
                } else {
                    target.style.setProperty('display', 'none', 'important');
                }
            } else {
                target.style.setProperty('visibility', 'hidden', 'important');
            }
            messaging.tell({
                what: 'injectedSelectors',
                type: 'net',
                hostname: window.location.hostname,
                selectors: tagName + '[' + prop + '="' + src + '"]'
            });
        };

        var details = {
            what: 'filterRequest',
            tagName: tagName,
            requestURL: src,
            pageHostname: window.location.hostname,
            pageURL: window.location.href
        };
        messaging.ask(details, onAnswerReceived);
    };

    var onResourceLoaded = function(ev) {
        //console.debug('Loaded %s[src="%s"]', ev.target.tagName, ev.target.src);
        onResource(ev.target, loadedElements);
    };

    var onResourceFailed = function(ev) {
        //console.debug('Failed to load %s[src="%s"]', ev.target.tagName, ev.target.src);
        onResource(ev.target, failedElements);
    };

    document.addEventListener('load', onResourceLoaded, true);
    document.addEventListener('error', onResourceFailed, true);
})();

/******************************************************************************/
/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/7

// Executed only once

(function() {
    var messaging = uBlockMessaging;

    var srcProps = {
        'embed': 'src',
        'iframe': 'src',
        'img': 'src',
        'object': 'data'
    };
    var elements = [];

    var onAnswerReceived = function(details) {
        if ( typeof details !== 'object' || details === null ) {
            return;
        }
        var requests = details.requests;
        var collapse = details.collapse;
        var selectors = [];
        var i = requests.length;
        var request, elem;
        while ( i-- ) {
            request = requests[i];
            elem = elements[request.index];
            if ( collapse ) {
                if ( elem.parentNode ) {
                    elem.parentNode.removeChild(elem);
                } else {
                    elem.style.setProperty('display', 'none', 'important');
                }
            } else {
                elem.style.setProperty('visibility', 'hidden', 'important');
            }
            selectors.push(request.tagName + '[' + srcProps[request.tagName] + '="' + request.url + '"]');
        }
        if ( selectors.length !== 0 ) {
            messaging.tell({
                what: 'injectedSelectors',
                type: 'net',
                hostname: window.location.hostname,
                selectors: selectors
            });
        }
    };

    var requests = [];
    var tagNames = ['embed','iframe','img','object'];
    var elementIndex = 0;
    var tagName, elems, i, elem, prop, src;
    while ( tagName = tagNames.pop() ) {
        elems = document.getElementsByTagName(tagName);
        i = elems.length;
        while ( i-- ) {
            elem = elems[i];
            prop = srcProps[tagName];
            if ( prop === undefined ) {
                continue;
            }
            src = elem[prop];
            if ( typeof src !== 'string' || src === '' ) {
                continue;
            }
            if ( src.slice(0, 4) !== 'http' ) {
                continue;
            }
            requests.push({
                index: elementIndex,
                tagName: tagName,
                url: src
            });
            elements[elementIndex] = elem;
            elementIndex += 1;
        }
    }
    var details = {
        what: 'filterRequests',
        pageURL: window.location.href,
        pageHostname: window.location.hostname,
        requests: requests
    };
    messaging.ask(details, onAnswerReceived);
})();

/******************************************************************************/
/******************************************************************************/

// To send mouse coordinates to context menu handler, as the chrome API fails
// to provide the mouse position to context menu listeners.
// This could be inserted in its own content script, but it's so simple that
// I feel it's not worth the overhead.

// Ref.: https://developer.mozilla.org/en-US/docs/Web/Events/contextmenu

(function() {
    var onContextMenu = function(ev) {
        uBlockMessaging.tell({
            what: 'contextMenuEvent',
            clientX: ev.clientX,
            clientY: ev.clientY
        });
    };
    document.addEventListener('contextmenu', onContextMenu);
})();

/******************************************************************************/

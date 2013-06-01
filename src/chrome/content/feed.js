// Author: Matija Podravec, 2012.

if (!mpagespace.model.feed) mpagespace.model.feed = {};
else if (typeof mpagespace.model.feed != 'object')
  throw new Error('mpagespace.feed already exists and is not an object');

mpagespace.model.feed = function(data, page) {
  this.url = data.url;
  this.title = data.title;
  this.id = data.widgetId;
  this.panelId = data.panelId;
  this.entriesToShow = data.entriesToShow ? data.entriesToShow : 5;
  this.hoursFilter = data.hoursFilter ? data.hoursFilter : 0;
  this.minimized = data.minimized ? true : false;
  this.visitedFilter = data.visitedFilter ? true : false;
  this.useGuid = data.useGuid ? true : false;
  this.entries = [];
  this.availableFeeds = data.availableFeeds ? data.availableFeeds : [];
  this.errorMessage = null;
  this.page = page;
  this.model = page.model;
  this.state = 'BLANK';  // possible values: BLANK, LOADED, LOADING, ERROR, SUBSCRIBING
  this.dirty = false;
}

mpagespace.model.feed.prototype = {
  getConfig: function() {
    return  {
      widgetId: this.id,
      panelId: this.panelId,
      title: this.title,
      url: this.url,
      availableFeeds: this.availableFeeds,
      hoursFilter: this.hoursFilter,
      visitedFilter: this.visitedFilter,
      useGuid: this.useGuid,
      entriesToShow: this.entriesToShow,
      minimized: this.minimized
    };      
  },

  isDirty: function() {
    return this.dirty == true;
  },

  isInitialized: function() {
    return ['LOADED', 'ERROR'].indexOf(this.state) != -1;
  },

  isInError: function() {
    return this.state == 'ERROR';
  },

  isInFeedSelectingState: function() {
    return this.state == 'LOADED' && this.availableFeeds.length > 0;
  },

  getErrorMessage: function() {
    if (this.isInError())
      if (this.errorMessage)
        return this.errorMessage;
      else
        return mpagespace.translate('widget.error.message');
    else
      return null;
  },

  set: function(property, value) {
    if (property == 'url') {
      var url1 = this.url;
      var parser = mpagespace.urlParser;
      var schemePos1 = {}, schemeLen1 = {}, authPos1 = {}, authLen1 = {}, pathPos1 = {}, pathLen1 = {};
      parser.parseURL(url1, url1.length, schemePos1, schemeLen1, authPos1, authLen1, pathPos1, pathLen1);

      var url2 = value;
      var schemePos2 = {}, schemeLen2 = {}, authPos2 = {}, authLen2 = {}, pathPos2 = {}, pathLen2 = {};
      parser.parseURL(url2, url2.length, schemePos2, schemeLen2, authPos2, authLen2, pathPos2, pathLen2);

      if (schemeLen2.value == -1) 
        this.url = 'http://' + url1.substr(authPos1.value, authLen1.value) + url2.substr(pathPos2.value, pathLen2.value); 
      else
        this.url = url2;

      this.availableFeeds = [];
      this.title = null;
      this.setDirty();
      this.load();
    } else if (property == 'useGuid') {
      this.useGuid = value;
      this.load();
    } else {
      this[property] = value;
      this.setDirty();
      mpagespace.observerService.notifyObservers(null, 'mpage-model', 'widget-changed:' + this.id + ':' + property);  
    }
  },

  setBulk: function(config) {
    var toLoad = false;
    for (property in config){
      if (property == 'useGuid')
        toLoad = true;
      this[property] = config[property];
    }
    this.setDirty();
    if (toLoad) 
      this.load();
    else
      mpagespace.observerService.notifyObservers(null, 'mpage-model', 'widget-changed:' + this.id);  
  },

  setDirty: function() {
    this.dirty = true;
    this.page.setDirty();
  },

  getEntriesToShow: function() {
    var historyService = Components.classes["@mozilla.org/browser/nav-history-service;1"]
      .getService(Components.interfaces.nsINavHistoryService);
    var result = []
    var entry;
    var hoursFilter = null;
    var options, query, rooNode;

    if (this.hoursFilter > 0) {
      hoursFilter = (new Date()).getTime() - this.hoursFilter * 60 * 60 * 1000;
    }

    options = historyService.getNewQueryOptions();
    query = historyService.getNewQuery();
    options.includeHidden = true;

    for (var i=0; i<this.entries.length; i++) {
      entry = this.entries[i];

      if (hoursFilter && e.date < hoursFilter) 
        continue;

      if (this.visitedFilter) {
        query.uri = entry.link;
        rootNode = historyService.executeQuery(query, options).root;
        rootNode.containerOpen = true;
        if (rootNode.childCount > 0) {
          rootNode.containerOpen = false;
          continue;
        }
        rootNode.containerOpen = false;
      }

      result.push(entry);
      if (result.length >= this.entriesToShow)
        break;
    }

    return result;
  },

  startVisitedFilterTimer: function() {
    if (!this.visitedFilter)
      return;

    var self = this;

    var timerCallback = {
      notify: function() {
        mpagespace.observerService.notifyObservers(null, 'mpage-model', 'widget-changed:' + self.id);  
        mpagespace.dump('feed.startVisitedFilterTimer: timer triggered for widget ' + self.id + '.');
      }
    };

    if (this.visitedFilterTimer)
      this.visitedFilterTimer.cancel();
    this.visitedFilterTimer = Components.classes["@mozilla.org/timer;1"]
                          .createInstance(Components.interfaces.nsITimer);
    this.visitedFilterTimer.initWithCallback(timerCallback, 1000, this.visitedFilterTimer.TYPE_ONE_SHOT);
  },

  releaseMemory: function() {
    this.entries = [];
    this.state = 'BLANK';
  },

  load: function(subscribing) {
    var self = this;

    var errorHandler = function() {
        self.state = 'ERROR';
        mpagespace.observerService.notifyObservers(null, 'mpage-model', 'widget-loaded:' + self.id);  
        mpagespace.dump('feed.load: ajax error handler executed for widget ' + self.id + '.');
    }

    var processHandler = function(request) {
      try {
        self.entries = [];
        self.process(request.responseText);
        self.state = 'LOADED';
        mpagespace.observerService.notifyObservers(null, 'mpage-model', 'widget-loaded:' + self.id);  
      } catch (e) {
        mpagespace.dump('feed.load: First level error on widget ' + self.id + ' - ' + e.message);
        try {
          if (self.state == 'SUBSCRIBING') {
            self.extractFeeds(request.responseText);
            self.state = 'LOADED';
            mpagespace.observerService.notifyObservers(null, 'mpage-model', 'widget-loaded:' + self.id);  
          } else {
            self.processNative(request.responseText);
          }
        } catch (e) {
          mpagespace.dump('feed.load: Second level error on widget ' + self.id + ' - ' + e.message);
          self.state = 'ERROR';
          mpagespace.observerService.notifyObservers(null, 'mpage-model', 'widget-loaded:' + self.id);  
        }
      }
    }

    if (subscribing) {
      mpagespace.dump('feed.load: Subscribing of widget ' + this.id + ' has been started.');
      this.state = 'SUBSCRIBING';
    } else 
      this.state = 'LOADING';

    this.errorMessage = null;
    mpagespace.ajax.load(this.url, processHandler, {errorHandler: errorHandler});  
  },

  extractFeeds: function(htmlText) {
    var index = 0;

    mpagespace.dump('feed.extractFeeds: Started');

    while ((index = htmlText.indexOf('<link', index)) != -1) {
      var endIndex = htmlText.indexOf('/>', index);
      if (endIndex == -1) endIndex = htmlText.indexOf('</link>', index);
      if (endIndex != -1) {
        var attributes = htmlText.substr(index, endIndex - index).match(/\w+\s*=\s*("[^"]*")|('[^']*')/ig);
        var title = mpagespace.translate('subscribe.noFeedTitle'), href = '', type = '';
        for (var i=0; i<attributes.length; i++) {
          var attribute = attributes[i].split('=');
          if (attribute.length != 2) continue;
          attribute[1] = attribute[1].substr(1, attribute[1].length - 2).trim();
          if (attribute[0].trim() == 'type') type = attribute[1];
          if (attribute[0].trim() == 'href') href = attribute[1];
          if (attribute[0].trim() == 'title') title = attribute[1];
        }
        var feedTypes = ['text/xml', 'application/rss+xml', 'application/atom+xml', 'application/xml', 'application/rdf+xml']; 
        if (feedTypes.indexOf(type) != -1) {
          this.availableFeeds.push({
            title: title,
            href: href
          });
        }
      }
      index++;
    }
    if (this.availableFeeds.length == 0) {
      this.errorMessage = mpagespace.translate('subscribe.noAvailableFeeds');
			throw new Error('No feeds found in HTML.');
    } else if (this.availableFeeds.length == 1) {
      this.set('url', this.availableFeeds[0].href); 
    }
  },

  processNative: function(feedText) {
    mpagespace.dump('feed.processNative: Started');
    var ios = Components.classes["@mozilla.org/network/io-service;1"]
                    .getService(Components.interfaces.nsIIOService);
    var uri = ios.newURI(this.url, null, null);
    var feedProcessor = Components.classes["@mozilla.org/feed-processor;1"]
                          .createInstance(Components.interfaces.nsIFeedProcessor);
    var self = this;

    feedProcessor.listener = {
      handleResult: function(result) {
        if (result.doc == null) {
          mpagespace.dump('feed.processNative: Error on widget ' + self.id + '.');
          self.state = 'ERROR';
        } else {
          var feed = result.doc;
          feed.QueryInterface(Components.interfaces.nsIFeed);

          for (var i=0; i<feed.items.length; i++){
            var entry = feed.items.queryElementAt(i, Components.interfaces.nsIFeedEntry);
            self.entries.push({
              title: entry.title.text,
              link: entry.link.resolve(''),
              date: Date.parse(entry.published)
            });
          }
          self.state = 'LOADED';
        }
        mpagespace.observerService.notifyObservers(null, 'mpage-model', 'widget-loaded:' + self.id);  
      }
    } 
    feedProcessor.parseFromString(feedText, uri);
  },

  process: function(feedText) {
    var ios = Components.classes["@mozilla.org/network/io-service;1"]
      .getService(Components.interfaces.nsIIOService);
    var parser = new DOMParser();
    var xmlDoc = parser.parseFromString(feedText, 'text/xml');
    var docEl = xmlDoc.documentElement;
    var nodes, node, entry, n;

    var isAtom = docEl.tagName == 'feed';
    var isRSS = docEl.tagName == 'rss';
    var isRdf = docEl.tagName == 'rdf:RDF';

    if (!isAtom && !isRSS && !isRdf) {
			throw new Error('Unsupported feed format.');
  	}

    var getNodeValue = function(node) {
      var res = '';

      node = node.firstChild;
      while (node && res == '') {
        res = node.nodeValue.trim();
        node = node.nextSibling;
      }
      return res;
    }

    var channelEl = xmlDoc.getElementsByTagName('channel')[0];
    if (!channelEl) channelEl = xmlDoc;
    if (this.title == null || this.state == 'SUBSCRIBING') {
      this.title = getNodeValue(channelEl.getElementsByTagName('title')[0]);
    }
    for (n = channelEl.firstChild; n; n = n.nextSibling){
      if (n.tagName && n.tagName.toLowerCase() == 'link') {
        this.siteUrl = getNodeValue(n);  
        break;
      }
    }
    var linkEl = channelEl.getElementsByTagName('link');
    if (linkEl) {
      if (linkEl[0] && linkEl[0].getAttribute('href'))
        this.siteUrl = linkEl[0].getAttribute('href');
      else if (linkEl[0]) 
        this.siteUrl = getNodeValue(linkEl[0]);
    }

    if (isRdf) { 
      nodes = xmlDoc.getElementsByTagName('item');
    } else if (isRSS) {
      nodes = channelEl.getElementsByTagName('item');
    } else {
      nodes = channelEl.getElementsByTagName('entry');
    }

    for (var i=0, count = nodes.length; i<count; i++){
      node = nodes[i];
      entry = {};
			entry.readed = false;

      for (var n = node.firstChild; n; n = n.nextSibling) {
        switch (n.tagName) {
          case 'title':
            if (!entry.title) entry.title = n.firstChild ? getNodeValue(n) : '';
            break;
          case 'summary':
          case 'content:encoded':
            entry.content = n.firstChild ? getNodeValue(n) : '';
            break;
          case 'content':
          case 'description':
            if (!entry.content) {
              entry.content = n.firstChild ? getNodeValue(n) : '';
              if (this.url.indexOf('reddit.com') != -1) {
                var pattern = /<a href="([^"]*)">\[link\]</;
                var result = entry.content.match(pattern);
                if (result != null) {
                  entry.reddit = ios.newURI(result[1], null, null);
                }
              } 
            }
            break;
          case 'enclosure':
            if (n.getAttribute('type') && n.getAttribute('type').indexOf('image') == 0) 
              entry.image = n.getAttribute('url');
            break;
          case 'link':
            if (n.getAttribute('rel') == 'enclosure') {
              entry.image = n.getAttribute('href');
            } else {
              if (isAtom) {
                entry.link = ios.newURI(n.getAttribute('href'), null, null);
              } else {
                entry.link = n.firstChild ? ios.newURI(getNodeValue(n), null, null) : null;
              }
            }
            break;
          case 'guid':
            if (this.useGuid) {
              entry.link = n.firstChild ? ios.newURI(getNodeValue(n), null, null) : entry.link;
            }
            break;
          case 'updated':
            entry.date = n.firstChild ? Date.parse(getNodeValue(n)) : null; 
            break;
          case 'modified':
          case 'pubDate':
          case 'dc:date':
            if (!entry.date) entry.date = n.firstChild ? Date.parse(getNodeValue(n)) : null; 
            break;
        }
      } 
      this.entries.push(entry);
    } 
  }
}

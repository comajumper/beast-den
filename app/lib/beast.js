/**
 * Beast
 * @version 0.17.2
 */

'use strict';

;(function () {

if (typeof window !== 'undefined') {
    window.Beast = {}
    document.addEventListener('DOMContentLoaded', function () {
        Beast.init()
    })
} else {
    global.Beast = {}
    module.exports = Beast
}

/*
 * Common vars
 */
var Declaration = {}                 // Declarations from Bease.decl()
var DeclarationFinished = false      // Flag turns true after the first Beast.node() call
var HttpRequestQueue = []            // Queue of required bml-files with link tag
var CssLinksToLoad = 0               // Num of <link rel="stylesheet"> in the <head>
var BeastIsReady = false             // If all styles and scripts are loaded
var OnBeastReadyCallbacks = []       // Functions to call when sources are ready
var ReStartBML = /<[a-z][^>]+\/?>/i  // Regular expression matches start of BML substring
var ReComment = /<!--[^]*-->/g       // Regular expression matches XML comments
var ReDoubleQuote = /"/g             // Regular expression matches all "-symbols

// Declaration properties that can't belong to user
var ReservedDeclarationProperies = {
    inherits:1,
    expand:1,
    mod:1,
    param:1,
    domInit:1,
    domAttr:1,
    mix:1,
    on:1,
    onWin:1,
    onMod:1,
    onRemove:1,
    tag:1,
    noElems:1,

    // 2 means not to inherit this field
    userMethods:2,
    commonExpand:2,
    commonDomInit:2,
    flattenInherits:2,
}

// CSS-properties measured in px commonly
var CssPxProperty = {
    height:1,
    width:1,
    left:1,
    right:1,
    bottom:1,
    top:1,
    'line-height':1,
    'font-size':1
}

/**
 * Initialize Beast
 */
Beast.init = function () {
    var links = document.getElementsByTagName('link')
    var bmlLinks = []

    for (var i = 0, ii = links.length; i < ii; i++) {
        var link = links[i]
        if (link.type === 'bml' || link.rel === 'bml') {
            RequireModule(link.href)
            bmlLinks.push(link)
        }
        if (link.rel === 'stylesheet') {
            CssLinksToLoad++
            link.onload = link.onerror = function () {
                CheckIfBeastIsReady()
            }
        }
    }

    for (var i = 0, ii = bmlLinks.length; i < ii; i++) {
        bmlLinks[i].parentNode.removeChild(bmlLinks[i])
    }

    CheckIfBeastIsReady()
}

/**
 * Require declaration script
 *
 * @url string Path to script file
 */
function RequireModule (url) {
    var xhr = new XMLHttpRequest()
    xhr.open('GET', url)
    xhr.onreadystatechange = function () {
        if (this.readyState === 4 && this.status === 200) {
            CheckIfBeastIsReady()
        }
    }
    HttpRequestQueue.push(xhr)
    xhr.send()
}

/**
 * Checks if all <link> are loaded
 */
function CheckIfBeastIsReady () {
    if (BeastIsReady) return

    var isReady = true

    for (var i = 0, ii = HttpRequestQueue.length; i < ii; i++) {
        var xhr = HttpRequestQueue[i]
        if (xhr.readyState !== 4 || xhr.status !== 200) {
            isReady = false
        }
    }
    if (document.styleSheets.length < CssLinksToLoad) {
        isReady = false
    }

    if (isReady) {
        for (var i = 0, ii = HttpRequestQueue.length; i < ii; i++) {
            EvalBml(
                HttpRequestQueue[i].responseText
            )
        }
        HttpRequestQueue = []
        ProcessBmlScripts()

        BeastIsReady = true
        for (var i = 0, ii = OnBeastReadyCallbacks.length; i < ii; i++) {
            OnBeastReadyCallbacks[i]()
        }
    }
}

/**
 * Converts <script type="bml"/> tag to Beast::evalBml() method
 */
function ProcessBmlScripts () {
    var scripts = document.getElementsByTagName('script')

    for (var i = 0, ii = scripts.length; i < ii; i++) {
        var script = scripts[i]
        var text = script.text

        if (script.type === 'bml' && text !== '') {
            EvalBml(text)
        }
    }
}

/**
 * Parses and attaches declaration to <head>-node.
 * If there's only XML inside, appends node to document.body.
 *
 * @text string Text to parse and attach
 */
function EvalBml (text) {
    var parsedText = Beast.parseBML(text)
    if (/^[\s\n]*</.test(text)) {
        parsedText = parsedText + (
            document.body
                ? '.render(document.body)'
                : '.render(document.documentElement)'
        )
    }

    eval(parsedText)
}


/**
 * Declaration standart fields:
 * - inherits string|array Inherited declarations by selector
 * - expand   function     Expand instructions
 * - mod      object       Default modifiers
 * - noElems  object       If block can have elements
 * - param    object       Default parameters
 * - domInit  function     DOM inititial instructions
 * - mix      string|array Additional CSS-classes
 * - on       object       Event handlers
 * - onWin    object       Window event hadnlers
 * - onMod    object       Modifier change actions
 * - tag      string       DOM tag name
 *
 * @selector string 'block' or 'block__elem'
 * @decl     object
 */
Beast.decl = function (selector, decl) {
    if (typeof selector === 'object') {
        for (var key in selector) Beast.decl(key, selector[key])
        return this
    }
    if (decl.inherits && typeof decl.inherits === 'string') {
        decl.inherits = [decl.inherits]
    }
    if (decl.mix && typeof decl.mix === 'string') {
        decl.mix = [decl.mix]
    }
    if (typeof Declaration[selector] !== 'undefined') {
        var oldDecl = Declaration[selector]
        for (var item in oldDecl) {
            if (typeof decl[item] === 'undefined') {
                decl[item] = oldDecl[item]
            }
        }
    }
    Declaration[selector] = decl

    return this
}

/**
 * Creates bemNode object
 *
 * @name    string         Node name
 * @attr    object         Node attributes
 * @content string|bemNode Last multiple argument
 * @return  BemNode
 */
Beast.node = function (name, attr) {
    // No more Beast.decl() after the first Beast.node() call
    if (!DeclarationFinished) {
        DeclarationFinished = true
        CompileDeclarations()
    }

    return new BemNode(
        name,
        attr,
        Array.prototype.splice.call(arguments, 2)
    )
}

/**
 * Compiles declaration fileds to methods, makes inheritances
 */
function CompileDeclarations () {
    function extend (obj, extObj) {
        for (var key in extObj) {
            if (ReservedDeclarationProperies[key] === 2) continue

            if (typeof obj[key] === 'undefined') {
                obj[key] = extObj[key]
            } else if (typeof extObj[key] === 'function' && !obj[key]._inheritedDeclFunction) {
                (function (fn, inheritedFn, inheritedDecl) {
                    fn._inheritedDeclFunction = function () {
                        // Imitate inherited decl context for inner inherited() calls
                        var temp = this._decl
                        this._decl = inheritedDecl
                        inheritedFn.apply(this, arguments)
                        this._decl = temp
                    }
                })(obj[key], extObj[key], extObj)
            } else if (typeof extObj[key] === 'object' && !Array.isArray(extObj[key])) {
                extend(obj[key], extObj[key])
            }
        }
    }

    function compileCommonHandler (commonHandlerName, handlers, decl) {
        if (handlers.length === 0) return

        decl[commonHandlerName] = function () {
            for (var i = 0, ii = handlers.length; i < ii; i++) {
                handlers[i].call(this)
            }
        }
    }

    function inherit (decl, inheritedDecls, flattenInherits) {
        for (var i = inheritedDecls.length-1; i >= 0; i--) {
            var selector = inheritedDecls[i]
            var inheritedDecl = Declaration[selector]

            if (typeof flattenInherits === 'undefined') {
                flattenInherits = []
            }
            flattenInherits.push(selector)

            if (inheritedDecl) {
                extend(decl, inheritedDecl)

                if (inheritedDecl.inherits) {
                    inherit(decl, inheritedDecl.inherits, flattenInherits)
                }
            }
        }

        return flattenInherits
    }

    for (var selector in Declaration) (function (decl) {

        // Extend decl with inherited rules
        if (decl.inherits) {
            var flattenInherits = inherit(decl, decl.inherits)
            decl.flattenInherits = flattenInherits
        }

        // Compile expand rules to methods array
        var expandHandlers = []
        if (decl.expand) {
            expandHandlers.unshift(decl.expand)
        }
        if (decl.param) {
            expandHandlers.unshift(function () {
                this.defineParam(decl.param)
            })
        }
        if (decl.mix) {
            expandHandlers.unshift(function () {
                this.mix.apply(this, decl.mix)
            })
        }
        if (flattenInherits) {
            expandHandlers.unshift(function () {
                this.mix.apply(this, flattenInherits)
            })
        }
        if (decl.mod) {
            expandHandlers.unshift(function () {
                this.defineMod(decl.mod)
            })
        }
        if (decl.tag) {
            expandHandlers.unshift(function () {
                this.tag(decl.tag)
            })
        }
        if (decl.noElems) {
            expandHandlers.unshift(function () {
                this.noElems(decl.noElems)
            })
        }
        if (decl.domAttr) {
            expandHandlers.unshift(function () {
                this.domAttr(decl.domAttr)
            })
        }
        if (decl.onMod) {
            expandHandlers.unshift(function () {
                for (var modName in decl.onMod) {
                    for (var modValue in decl.onMod[modName]) {
                        this.onMod(modName, modValue, decl.onMod[modName][modValue])
                    }
                }
            })
        }

        // Compile domInit rules to methods array
        var domInitHandlers = []
        if (decl.domInit) {
            domInitHandlers.unshift(decl.domInit)
        }
        if (decl.on) {
            domInitHandlers.unshift(function () {
                for (var events in decl.on) {
                    this.on(events, decl.on[events])
                }
            })
        }
        if (decl.onWin) {
            domInitHandlers.unshift(function () {
                for (var events in decl.onWin) {
                    this.onWin(events, decl.onWin[events])
                }
            })
        }

        // Compile destructor
        if (typeof decl.onRemove === 'undefined') {
            decl.onRemove = function () {}
        }

        // Compile common handlers
        compileCommonHandler('commonExpand', expandHandlers, decl)
        compileCommonHandler('commonDomInit', domInitHandlers, decl)

        // Extract user methods
        decl.userMethods = {}
        for (var key in decl) {
            if (ReservedDeclarationProperies[key] !== 1) {
                decl.userMethods[key] = decl[key]
            }
        }

    })(Declaration[selector])
}

/**
 * Set callback when Beast is ready
 *
 * @callback function Function to call
 */
Beast.onReady = function (callback) {
    if (BeastIsReady) {
        callback()
    } else {
        OnBeastReadyCallbacks.push(callback)
    }
}

/**
 * Looks for '<foo><bar>...</bar></foo>'-substrings and replaces with js-equiualents.
 * Algorythm:
 * - Find XML-node in text
 * - First node in siquence is root
 * - If root is sinle then ParseBMLNode(root) and finish
 * - Else look for root is closing and there's no opening node
 *   with the same name behind the root
 * - When find whole XML-substring, split it by '<' and parse by element
 *
 * @text   string Text to parse
 * @return string Parsed text
 */
Beast.parseBML = function (text) {
    var startParams

    text = text.replace(ReComment, '')

    do {
        startParams = ReStartBML.exec(text)

        if (startParams === null) {
            return text
        }

        var matched = startParams[0]
        var bmlStartsAt = startParams.index
        var bmlEndsAt

        if (matched[matched.length-2] === '/') {
            bmlEndsAt = matched.length
        } else {
            var nameEndsAt = matched.indexOf('\n')
            if (nameEndsAt < 0) nameEndsAt = matched.indexOf(' ')
            if (nameEndsAt < 0) nameEndsAt = matched.length-1

            var name = matched.substr(1, nameEndsAt-1)
            var reOpenedNodesWithSameName = new RegExp('<'+ name +'(?:|[ \n][^>]*)>', 'g')
            var closedNode = '</'+ name +'>'
            var textPortion = text.substr(bmlStartsAt+1)
            var closedNodes = -1
            var openedNodes = 0
            var textBeforeClosedNode
            var textAfterClosedNode
            var indexOffset = 0

            do {
                bmlEndsAt = indexOffset === 0
                    ? textPortion.search(closedNode)
                    : textAfterClosedNode.search(closedNode) + indexOffset

                textBeforeClosedNode = textPortion.substr(0, bmlEndsAt)
                textAfterClosedNode = textPortion.substr(bmlEndsAt + 1)

                openedNodes = textBeforeClosedNode.match(reOpenedNodesWithSameName)
                openedNodes = openedNodes !== null ? openedNodes.length : 0

                closedNodes++
                indexOffset = bmlEndsAt + 1
            } while (
                openedNodes > closedNodes
            )

            bmlEndsAt += 1 + closedNode.length
        }

        var textPortion = text.substr(bmlStartsAt, bmlEndsAt)
        var textPortionReplace = ''
        var buffer = ''
        var splitBML = []
        var current
        var prev = ''
        var openBraceNum = 0

        for (var i = 0, ii = textPortion.length; i < ii; i++) {
            current = textPortion[i]

            if (current === '\n') {
                continue
            }

            if (current === '{' && prev !== '\\') {
                openBraceNum++
            }

            if (current === '}' && prev !== '\\') {
                openBraceNum--
            }

            if (current === '<' && openBraceNum === 0) {
                splitBML.push(buffer)
                buffer = ''
            }

            buffer += current

            if (current === '>' && openBraceNum === 0) {
                splitBML.push(buffer)
                buffer = ''
            }

            prev = current
        }

        if (buffer !== '') {
            splitBML.push(textPortion)
        }

        var first = true
        var inParentContext

        for (var i = 0, ii = splitBML.length; i < ii; i++) {
            var current = splitBML[i]

            if (current === '') continue

            var firstChar = current.substr(0,1)
            var firstTwoChars = current.substr(0,2)
            var lastChar = current.substr(current.length-1)
            var lastTwoChars = current.substr(current.length-2)

            if (firstTwoChars === '</' && lastChar === '>') {
                textPortionReplace += ')'
                continue
            }

            if (first) {
                first = false
                inParentContext = true
            } else {
                textPortionReplace += ', '
                inParentContext = false
            }

            if (firstChar === '<' && lastTwoChars === '/>') {
                textPortionReplace += ParseBMLNode(current, true, inParentContext)
                continue
            }

            if (firstChar === '<' && lastChar === '>') {
                textPortionReplace += ParseBMLNode(current, false, inParentContext)
                continue
            }

            if (firstChar === '<') {
                return console.error('Unclosed node:', current)
            }

            textPortionReplace += ParseTextInsideBML(current)
        }

        text = text.substr(0, bmlStartsAt) + textPortionReplace + text.substr(bmlStartsAt + bmlEndsAt)
    } while (true)
}

/**
 * Looks for '{...}'-substrings and replaces with js-concatinations.
 *
 * @text string Text to parse
 */
function ParseTextInsideBML (text) {
    var result = ''
    var openBraceNum = 0
    var prevSymbol = ''
    var symbol

    for (var i = 0, ii = text.length; i < ii; i++) {
        symbol = text[i]

        if (symbol === '{' && prevSymbol !== '\\') {
            openBraceNum++
            if (openBraceNum === 1) {
                if (result !== '') {
                    result += "',"
                }
            } else {
                result += symbol
            }
        } else if (openBraceNum > 0 && symbol === '}') {
            openBraceNum--
            if (openBraceNum === 0) {
                if (i < ii-1 && text[i+1] !== '{') {
                    result += ",'"
                }
            } else {
                result += symbol
            }
        } else if (openBraceNum === 0) {
            if (i === 0) result += "'"
            if (symbol === "'") result += '\\'
            result += symbol
            if (i === ii-1) result += "'"
        } else {
            result += symbol
        }

        prevSymbol = symbol
    }

    return result
}

/**
 * Converts '<foo>...</foo>' to 'Beast.node('foo', ...)'
 *
 * @text   string  Text to parse
 * @single boolean If node is sinle (<node/>)
 * @isRoot boolean If node is root of bml tree, it gets call-context of parent block
 * @return string  Javascript code
 */
function ParseBMLNode (text, single, isRoot) {
    text = text.substr(1)
    text = text.substr(
        0, text.length - (single ? 2 : 1)
    )

    var parsed = ParseNameAndAttrOfBMLNode(text)

    if (isRoot) {
        parsed.attr += (parsed.attr === '' ? '' : ',') + "'context':this"
    }

    if (parsed.attr === '') {
        parsed.attr === 'null'
    }

    return "Beast.node('" + parsed.name + "',{" + parsed.attr + "}" + (single ? ')' : '')
}

/**
 * Parses XML-substring with node name and attributes to json string
 */
function ParseNameAndAttrOfBMLNode (text) {
    var nodeName
    var attr = ''
    var buffer = ''
    var openQuote = ''
    var attrName
    var escape = false

    for (var i = 0, ii = text.length-1; i <= ii; i++) {
        var s = text[i]

        // last symbol always metters
        if (i === ii && s !== ' ' && s !== '\n' && s !== "'" && s !== '"' && s !== '=') {
            buffer += s
        }

        // node name
        if ((s === ' ' || s === '\n' || i === ii) && typeof nodeName === 'undefined') {
            nodeName = buffer
            buffer = ''
        }
        // boolean attr
        else if ((s === ' ' || s === '\n' || i === ii) && buffer !== '' && openQuote === '') {
            attr += "'"+ buffer +"':true,"
            buffer = ''
        }
        // attr name
        else if (s === '=' && openQuote === '') {
            attrName = buffer
            buffer = ''
        }
        // attr value start
        else if ((s === '"' || s === "'") && openQuote === '') {
            openQuote = s
        }
        // attr value finish
        else if (s === openQuote && !escape) {
            attr += "'"+ attrName +"':"+ (buffer === '' ? 'false' : ParseTextInsideBML(buffer)) + ","
            openQuote = ''
            buffer = ''
        }
        // when spaces metter
        else if ((s === ' ' || s === '\n') && openQuote !== '') {
            buffer += s
        }
        // read symbol
        else if (s !== ' ' && s !== '\n') {
            buffer += s
        }

        escape = s === '\\'
    }

    if (attr !== '') {
        attr = attr.substring(0, attr.length-1)
    }

    return {
        name: nodeName,
        attr: attr
    }
}

/**
 * BEM node class
 *
 * @nodeName string Starts with capital for block else for elem
 * @attr     object List of attributes
 * @children array  Child nodes
 */
var BemNode = function (nodeName, attr, children) {
    this._name = ''                 // BEM-name: 'block' or 'block__elem'
    this._nodeName = nodeName       // BML-node name
    this._attr = attr || {}         // BML-node attributes
    this._isBlock = false           // flag if node is block
    this._isElem = false            // flag if node is elem
    this._mod = {}                  // modifiers list
    this._modHandlers = {}          // handlers on modifiers change
    this._param = {}                // parameters list
    this._domNode = null            // DOM-node reference
    this._domAttr = {}              // DOM-attributes
    this._afterDomInitHandlers = [] // Handlers called after DOM-node inited
    this._domInited = false         // Flag if DOM-node inited
    this._parentBlock = null        // parent block bemNode reference
    this._forcedParentBlock = false // flag if parentBlock was set manualy with block param
    this._parentNode = null         // parent bemNode reference
    this._prevParentNode = null     // previous parent node value when parent node redefined
    this._children = []             // list of children
    this._expandedChildren = null   // list of expanded children (for expand method purposes)
    this._isExpanded = false        // if Bem-node was expanded
    this._isExpandContext = false   // when flag is true append modifies expandedChildren
    this._isReplaceContext = false  // when flag is true append don't renders children's DOM
    this._mix = []                  // list of additional CSS-classes
    this._tag = 'div'               // DOM-node name
    this._id = ''                   // Node identifier
    this._noElems = false           // Flag if block can have children
    this._implementedNode = null    // Node wich this node implements
    this._css = {}                  // css properties
    this._decl = null               // declaration for component
    this._kindOf = []               // inherited declaration selectors including itself for component
    this._renderedOnce = false      // flag if component was rendered at least once
    this._elems = []                // array of elements (for block only)

    // Define if block or elem
    var firstLetter = nodeName.substr(0,1)
    this._isBlock = firstLetter === firstLetter.toUpperCase()
    this._isElem = !this._isBlock

    if (this._isBlock) {
        this._name = nodeName.toLowerCase()
        this._decl = Declaration[this._name]
        this._parentBlock = this
        this._defineUserMethods()
    }

    // Define mods, params and special params
    for (var key in this._attr) {
        var firstLetter = key.substr(0,1)
        if (firstLetter === firstLetter.toUpperCase()) {
            this._mod[key.toLowerCase()] = this._attr[key]
        } else if (key === 'mix') {
            this._mix = this._attr.mix.split(' ')
        } else if (key === 'context' && !this._parentBlock) {
            this.parentBlock(this._attr.context)
        } else if (key === 'block') {
            this.parentBlock(this._attr.block, true)
            this._forcedParentBlock = true
        } else if (key === 'tag') {
            this._tag = this._attr.tag
        } else if (key === 'id') {
            this._id = this._attr.id
        } else {
            this._param[key] = this._attr[key]
        }
    }

    // Append children
    this.append.apply(this, children)
}

BemNode.prototype = {

    /**
     * Defines user's methods
     */
    _defineUserMethods: function (selector) {
        var decl = selector ? Declaration[selector] : this._decl
        if (decl) {
            for (var methodName in decl.userMethods) {
                this[methodName] = decl.userMethods[methodName]
            }
        }
    },

    /**
     * Clears user's methods
     */
    _clearUserMethods: function () {
        if (this._name === '' || !Declaration[this._name]) return
        var userMethods = Declaration[this._name].userMethods
        for (var methodName in userMethods) {
            this[methodName] = null
        }
    },

    /**
     * Runs overwritten method's code
     *
     * @caller function ECMA6 claims caller function link
     */
    inherited: function (caller) {
        if (caller && typeof caller._inheritedDeclFunction !== 'undefined') {
            caller._inheritedDeclFunction.apply(
                this,
                Array.prototype.splice.call(arguments, 1)
            )
        }

        return this
    },

    /**
     * Checks if component is @selctor was inherited from @selector
     *
     * @selector string
     * @return boolean
     */
    isKindOf: function (selector) {
        var isKindOfSelector = this._name === selector

        if (!isKindOfSelector && this._decl && this._decl.flattenInherits) {
            isKindOfSelector = this._decl.flattenInherits.indexOf(selector) > -1
        }

        return isKindOfSelector
    },

    /**
     * If node is block
     *
     * @return boolean
     */
    isBlock: function () {
        return this._isBlock
    },

    /**
     * If node is element
     *
     * @return boolean
     */
    isElem: function () {
        return this._isElem
    },

    /**
     * Gets block or element name: 'block' or 'block__element'
     *
     * @return string
     */
    selector: function () {
        return this._name
    },

    /**
     * Gets or sets node's identifier
     *
     * @return string
     */
    id: function (id) {
        if (typeof id === 'undefined') {
            return this._id
        } else {
            this._id = id
            if (this._domNode) {
                this._domNode.id = id
            }
            return this
        }
    },

    /**
     * Gets or sets node's tag name
     *
     * @return string
     */
    tag: function (tag) {
        if (typeof tag === 'undefined') {
            return this._tag
        } else {
            if (!this._domNode) {
                this._tag = tag
            }
            return this
        }
    },

    /**
     * Sets css
     *
     * @name  string        css-property name
     * @value string|number css-property value
     */
    css: function (name, value) {
        if (typeof name === 'object') {
            for (var key in name) this.css(key, name[key])
        } else if (typeof value === 'undefined') {
            if (this._domNode) {
                return window.getComputedStyle(this._domNode).getPropertyValue(name)
            } else {
                return this._css[name]
            }
        } else {
            if (typeof value === 'number' && CssPxProperty[name]) {
                value += 'px'
            }

            this._css[name] = value

            if (this._domNode) {
                this._setDomNodeCSS()
            }
        }

        return this
    },

    /**
     * Sets _noElems flag
     *
     * @value  boolean
     */
    noElems: function (value) {
        this._noElems = value
        this._setParentBlockForChildren(this, this._parentBlock._parentNode)
        return this
    },

    /**
     * Only for elements. Gets or sets parent block bemNode reference.
     * Also sets bemNode name adding 'blockName__' before element name.
     * [@bemNode, [@dontAffectChildren]]
     *
     * @bemNode            object  Parent block node
     * @dontAffectChildren boolean If true, children won't get this parent block reference
     */
    parentBlock: function (bemNode, dontAffectChildren) {
        if (bemNode) {
            if (this._isElem
                && bemNode instanceof BemNode
                && bemNode !== this._parentBlock
                && !this._forcedParentBlock) {

                if (bemNode._parentBlock && bemNode._parentBlock._noElems) {
                    return this.parentBlock(bemNode._parentNode, dontAffectChildren)
                }

                this._clearUserMethods()
                this._removeFromParentBlockElems()
                this._parentBlock = bemNode._parentBlock
                this._addToParentBlockElems()
                this._name = this._parentBlock._name + '__' + this._nodeName
                this._decl = Declaration[this._name]
                this._defineUserMethods()

                if (!dontAffectChildren) {
                    this._setParentBlockForChildren(this, bemNode)
                }
            }
            return this
        } else {
            return this._implementedNode
                ? this._implementedNode._parentBlock
                : this._parentBlock
        }
    },

    /**
     * Recursive parent block setting
     *
     * @bemNode     object current node with children
     * @parentBlock object paren block reference
     */
    _setParentBlockForChildren: function (bemNode, parentBlock) {
        for (var i = 0, ii = bemNode._children.length; i < ii; i++) {
            var child = bemNode._children[i]
            if (child instanceof BemNode && child._isElem) {
                child.parentBlock(parentBlock)
            }
        }
    },

    /**
     * Gets or sets parent bemNode reference
     * [@bemNode]
     *
     * @bemNode object parent node
     */
    parentNode: function (bemNode) {
        if (typeof bemNode !== 'undefined') {
            if (this._renderedOnce) {
                this.remove(true)
            }
            if (bemNode !== this._parentNode) {
                this._prevParentNode = this._parentNode
                this._parentNode = bemNode
            }
            return this
        } else {
            return this._parentNode
        }
    },

    /**
     * Gets DOM-node reference
     */
    domNode: function () {
        return this._domNode
    },

    /**
     * Set or get dom attr
     * @name, [@value]
     *
     * @name  string Attribute name
     * @value string Attribute value
     */
    domAttr: function (name, value, domOnly) {
        if (typeof name === 'object') {
            for (var key in name) this.domAttr(key, name[key])
        } else if (typeof value === 'undefined') {
            return this._domAttr[name]
        } else {
            if (!domOnly) {
                this._domAttr[name] = value
            }
            if (this._domNode) {
                if (value === false || value === '') {
                    this._domNode.removeAttribute(name)
                } else {
                    this._domNode.setAttribute(name, value)
                }
            }
        }

        return this
    },

    /**
     * Set additional classes
     */
    mix: function () {
        for (var i = 0, ii = arguments.length; i < ii; i++) {
            this._mix.push(arguments[i])
        }
        if (this._domNode) {
            this._setDomNodeClasses()
        }

        return this
    },

    /**
     * Define modifiers and its default values
     */
    defineMod: function (defaults) {
        if (this._implementedNode) {
            this._implementedNode._extendProperty('_mod', defaults)
        }
        return this._extendProperty('_mod', defaults)
    },

    /**
     * Exntends object property with default object
     *
     * @propertyName string
     * @defaults     object
     */
    _extendProperty: function (propertyName, defaults)
    {
        var actuals = this[propertyName]

        for (var key in defaults) {
            if (typeof actuals[key] !== 'undefined' && actuals[key] !== '') {
                this[propertyName][key] = actuals[key]
            } else {
                this[propertyName][key] = defaults[key]
            }
        }

        return this
    },

    /**
     * Define parameters and its default values
     */
    defineParam: function (defaults) {
        return this._extendProperty('_param', defaults)
    },

    /**
     * Sets or gets mod.
     * @name, [@value, [@data]]
     *
     * @name  string         Modifier name
     * @value string|boolean Modifier value
     * @data  anything       Additional data
     */
    mod: function (name, value, data) {
        if (typeof name === 'object') {
            for (var key in name) this.mod(key, name[key])
        } else if (typeof value === 'undefined') {
            return this._mod[name]
        } else if (this._mod[name] !== value) {
            this._mod[name] = value
            if (this._implementedNode) {
                this._implementedNode._mod[name] = value
            }
            if (this._domNode) {
                this._setDomNodeClasses()
                this._callModHandlers(name, value, data)
            }
        }

        return this
    },

    /**
     * Toggles mods.
     *
     * @name   string         Modifier name
     * @value1 string|boolean Modifier value 1
     * @value2 string|boolean Modifier value 2
     */
    toggleMod: function (name, value1, value2) {
        if (!this.mod(name) || this.mod(name) === value2) {
            this.mod(name, value1)
        } else {
            this.mod(name, value2)
        }

        return this
    },

    /**
     * Sets or gets parameter.
     * @name, [@value]
     *
     * @name  string
     * @value anything
     */
    param: function (name, value) {
        if (typeof name === 'object') {
            for (var key in name) this.param(key, name[key])
        } else if (typeof value === 'undefined') {
            return this._param[name]
        } else {
            this._param[name] = value
        }

        return this
    },

    /**
     * Sets events handler
     *
     * @events  string   Space splitted event list: 'click' or 'click keypress'
     * @handler function
     */
    on: function (events, handler) {
        var eventsArray = events.split(' ')
        for (var i = 0, ii = eventsArray.length; i < ii; i++) {
            (function (bemNode, event) {
                bemNode._domNode.addEventListener(event, function (e) {
                    handler.call(bemNode, e, e.detail)
                })
            })(this, eventsArray[i])
        }

        return this
    },

    /**
     * Sets modifier change handler
     *
     * @modName  string
     * @modValue string|boolean
     * @handler  function
     */
    onWin: function (events, handler) {
        var eventsArray = events.split(' ')
        for (var i = 0, ii = eventsArray.length; i < ii; i++) {
            (function (bemNode, event) {
                window.addEventListener(event, function (e) {
                    handler.call(bemNode, e, e.detail)
                })
            })(this, eventsArray[i])
        }

        return this
    },

    /**
     * Sets modifier change handler
     *
     * @modName  string
     * @modValue string|boolean
     * @handler  function
     */
    onMod: function (modName, modValue, handler) {
        if (typeof this._modHandlers[modName] === 'undefined') {
            this._modHandlers[modName] = {}
        }
        if (typeof this._modHandlers[modName][modValue] === 'undefined') {
            this._modHandlers[modName][modValue] = []
        }
        this._modHandlers[modName][modValue].push(handler)

        return this
    },

    /**
     * Triggers event
     *
     * @eventName string
     * @data      anything Additional data
     */
    trigger: function (eventName, data) {
        if (this._domNode) {
            this._domNode.dispatchEvent(
                data
                    ? new CustomEvent(eventName, {detail:data})
                    : new Event(eventName)
            )
        }

        return this
    },

    /**
     * Triggers window event
     *
     * @eventName string
     * @data      anything Additional data
     */
    triggerWin: function (eventName, data) {
        if (this._domNode) {
            eventName = this.parentBlock()._name + ':' + eventName
            window.dispatchEvent(
                data
                    ? new CustomEvent(eventName, {detail:data})
                    : new Event(eventName)
            )
        }

        return this
    },

    /**
     * Gets current node index among siblings
     *
     * @return number
     */
    index: function () {
        var siblings = this._parentNode._children
        var dec = 0
        for (var i = 0, ii = siblings.length; i < ii; i++) {
            if (typeof siblings[i] === 'string') dec++
            if (siblings[i] === this) return i-dec
        }
    },

    /**
     * Empties children.
     */
    empty: function () {
        var children

        if (this._isExpandContext) {
            children = this._expandedChildren
            this._expandedChildren = []
        } else {
            children = this._children
            this._children = []
        }

        if (children) {
            for (var i = 0, ii = children.length; i < ii; i++) {
                if (children[i] instanceof BemNode) {
                    children[i]._unlink()
                    children[i]._removeFromParentBlockElems()
                }
            }
        }

        if (this._domNode) {
            while (this._domNode.firstChild) {
                this._domNode.removeChild(this._domNode.firstChild)
            }
        }

        return this
    },

    /**
     * Unlinks node from the common list of nodes
     */
    _unlink: function () {
        var decl = this._decl
        if (decl) {
            decl.onRemove.call(this)
        }
    },

    /**
     * Remove compontent from parent block elems array
     */
    _removeFromParentBlockElems: function () {
        var parentBlock

        if (this._isElem) {
            parentBlock = this._parentBlock
        } else if (this._isBlock && this._implementedNode) {
            parentBlock = this._implementedNode._parentBlock
        }

        if (parentBlock) {
            for (var i = 0, ii = this._parentBlock._elems.length; i < ii; i++) {
                if (this._parentBlock._elems[i] === this) {
                    this._parentBlock._elems.splice(i,1)
                    break
                }
            }
        }
    },

    /**
     * Add compontent to parent block elems array
     */
    _addToParentBlockElems: function () {
        var parentBlock

        if (this._isElem) {
            parentBlock = this._parentBlock
        } else if (this._isBlock && this._implementedNode) {
            parentBlock = this._implementedNode._parentBlock
        }

        if (parentBlock) {
            parentBlock._elems.push(this)
        }
    },

    /**
     * Removes current node
     */
    remove: function (dontUnlink) {
        if (this._domNode && this._domNode.parentNode) {
            this._domNode.parentNode.removeChild(this._domNode)
        }

        if (this._parentNode) {
            this._parentNode._children.splice(
                this._parentNode._children.indexOf(this), 1
            )
            this._parentNode = null
        }

        if (!dontUnlink) {
            this._unlink()
        }

        this._removeFromParentBlockElems()

        return this
    },

    /**
     * Appends new children. If there's no DOM yet,
     * appends to expandedChildren else appends to children
     * and renders its DOM.
     *
     * @children string|object Multiple argument
     */
    append: function () {
        for (var i = 0, ii = arguments.length; i < ii; i++) {
            var child = arguments[i]

            if (child === false || child === null || typeof child === 'undefined') {
                continue
            } else if (Array.isArray(child)) {
                this.append.apply(this, child)
                continue
            } else if (child instanceof BemNode) {
                child.parentNode(this)
                if (child._isElem) {
                    if (this._isBlock) {
                        child.parentBlock(this)
                    } else if (this._attr.context) {
                        child.parentBlock(this._parentBlock)
                    }
                }
            } else if (typeof child === 'number') {
                child = child.toString()
            }

            if (this._domNode && !this._isReplaceContext) {
                this._children.push(child)
                this._renderChildWithIndex(this._children.length-1)
            } else if (this._isExpandContext) {
                if (!this._expandedChildren) this._expandedChildren = []
                this._expandedChildren.push(child)
            } else {
                this._children.push(child)
            }
        }

        return this
    },

    /**
     * Appends node to the target. If current node belongs to another parent,
     * method removes it from the old context.
     *
     * @bemNode object Target
     */
    appendTo: function (bemNode) {
        this.remove(true)
        bemNode.append(this)

        return this
    },

    /**
     * Replaces current bemNode with the new
     */
    replaceWith: function (bemNode) {
        this._completeExpand()

        var parentNode = this._parentNode
        var siblingsAfter

        if (parentNode) {
            if (parentNode === bemNode) {
                parentNode = this._prevParentNode
            } else {
                siblingsAfter = parentNode._children.splice(this.index())
                siblingsAfter.shift()
            }
            parentNode._isReplaceContext = true
            parentNode.append(bemNode)
            parentNode._isReplaceContext = false
        }

        if (siblingsAfter) {
            parentNode._children = parentNode._children.concat(siblingsAfter)
        }

        this._parentNode = null

        if (bemNode instanceof BemNode) {
            if (bemNode._isBlock) {
                bemNode._resetParentBlockForChildren()
            }
            bemNode.render()
        }
    },

    /**
     * Recursive setting parentBlock as this for child elements
     */
    _resetParentBlockForChildren: function () {
        for (var i = 0, ii = this._children.length; i < ii; i++) {
            var child = this._children[i]
            if (child instanceof BemNode && child._isElem) {
                child.parentBlock(this._parentBlock)
                child._resetParentBlockForChildren(this._parentBlock)
            }
        }
    },

    /**
     * Replaces current bemNode with the new wich implemets its declaration
     */
    implementWith: function (bemNode) {
        this._setDomNodeClasses()
        bemNode._implementedNode = this
        bemNode._extendProperty('_mod', this._mod)
        bemNode._extendProperty('_param', this._param)
        this._extendProperty('_mod', bemNode._mod)
        bemNode._defineUserMethods(this._name)
        this.replaceWith(bemNode)
        this._removeFromParentBlockElems()
        bemNode._addToParentBlockElems()
    },

    /**
     * Filters text in children
     *
     * @return string
     */
    text: function () {
        var text = ''
        for (var i = 0, ii = this._children.length; i < ii; i++) {
            if (typeof this._children[i] === 'string') {
                text += this._children[i]
            }
        }

        return text
    },

    /**
     * Gets elements by name
     */
    elem: function () {
        if (this._isElem) return

        if (arguments.length === 0) {
            return this._elems
        }

        var elems = []
        for (var i = 0, ii = this._elems.length, elem; i < ii; i++) {
            elem = this._elems[i]
            for (var j = 0, jj = arguments.length; j < jj; j++) {
                if (elem._nodeName === arguments[j] ||
                    elem._implementedNode && elem._implementedNode._nodeName === arguments[j]
                ) {
                    elems.push(elem)
                }
            }
        }

        return elems
    },

    /**
     * Finds bemNodes and attributes by paths:
     * - nodeName1 (children)
     * - nodeName1/ (all children of children)
     * - nodeName1/nodeName2 (children of children)
     * - ../nodeName1 (children of parent)
     *
     * @path   string Multiple argument: path to node or attribute
     * @return array  bemNodes collection
     */
    get: function () {
        if (arguments.length === 0) return this._children

        var collections = []

        for (var i = 0, ii = arguments.length, collection; i < ii; i++) {
            if (arguments[i] === '/') {
                collection = this._filterChildNodes('')
            } else {
                var pathItems = arguments[i].split('/')

                for (var j = 0, jj = pathItems.length; j < jj; j++) {
                    var pathItem = pathItems[j]

                    if (j === 0) {
                        collection = this._filterChildNodes(pathItem)
                    } else {
                        var prevCollection = collection
                        collection = []
                        for (var k = 0, kk = prevCollection.length; k < kk; k++) {
                            collection = collection.concat(
                                this._filterChildNodes.call(prevCollection[k], pathItem)
                            )
                        }
                    }

                    if (collection.length === 0) {
                        break
                    }
                }
            }

            if (ii === 1) {
                collections = collection
            } else {
                collections = collections.concat(collection)
            }
        }

        return collections
    },

    /**
     * Collects children by node name
     *
     * @name   string Child node name
     * @return array  Filtered children
     */
    _filterChildNodes: function (name) {
        if (name === '..') {
            return [this._parentNode]
        }

        var collection = []
        for (var i = 0, ii = this._children.length; i < ii; i++) {
            var child = this._children[i]
            if (
                child instanceof BemNode && (
                    name === ''
                    || name === child._nodeName
                    || child._implementedNode && name === child._implementedNode._nodeName
                )
            ) {
                collection.push(child)
            }
        }

        return collection
    },

    /**
     * Variation of get() method with current block forcing
     */
    getWithContext: function () {
        var children = this.get.apply(this, arguments)
        for (var i = 0, ii = children.length; i < ii; i++) {
            if (children[i] instanceof BemNode) {
                children[i]._forcedParentBlock = true
            }
        }
        return children
    },

    /**
     * Checks if there are any children
     *
     * @path string Multiple argument: path to node or attribute
     */
    has: function () {
        return this.get.apply(this, arguments).length > 0
    },

    /**
     * Set handler to call afted DOM-node inited
     *
     * @callback function Handler to call
     */
    afterDomInit: function (handler) {
        if (!this._domInited) {
            this._afterDomInitHandlers.push(handler)
        } else {
            handler.call(this)
        }

        return this
    },

    /**
     * Clones itself
     */
    clone: function () {
        var clone = {}
        clone.__proto__ = this.__proto__

        for (var key in this) {
            if (key === '_children') {
                var cloneChildren = []
                for (var i = 0, ii = this._children.length; i < ii; i++) {
                    cloneChildren.push(
                        this._children[i] instanceof BemNode
                            ? this._children[i].clone()
                            : this._children[i]
                    )
                }
                clone._children = cloneChildren
            } else {
                clone[key] = this[key]
            }
        }

        return clone
    },

    /**
     * Expands bemNode. Creates DOM-node and appends to the parent bemNode's DOM.
     * Also renders its children. Inits DOM declarations at the end.
     *
     * @parentDOMNode object Parent for the root node attaching
     */
    render: function (parentDOMNode) {

        // Call expand handler
        if (!this._isExpanded && this._decl && this._decl.commonExpand) {
            this._isExpandContext = true
            this._decl.commonExpand.call(this)
            this._completeExpand()
            this._isExpandContext = false
        }

        // Continue only if parent node is defined
        if (!parentDOMNode && !this._parentNode) {
            return this
        }

        // Create DOM element if there isn't
        if (!this._domNode) {
            this._domNode = document.createElement(this._tag)
            this._domNode.bemNode = this

            if (this._id !== '') {
                this._domNode.id = this._id
            }

            this._setDomNodeClasses()
            this._setDomNodeCSS()

            for (var key in this._domAttr) {
                this.domAttr(key, this._domAttr[key], true)
            }
        }

        // Append to DOM tree
        if (parentDOMNode) {
            parentDOMNode.appendChild(this._domNode)
        } else {
            this._parentNode._domNode.appendChild(this._domNode)
        }

        // When first time render
        if (!this._renderedOnce) {

            // Render children
            for (var i = 0, ii = this._children.length; i < ii; i++) {
                this._renderChildWithIndex(i)
            }

            // For HTML-body remove previous body tag
            if (this._tag === 'body') {
                document.documentElement.replaceChild(this._domNode, document.body)
            }

            // Call mod handlers
            for (var modName in this._mod) {
                this._callModHandlers(modName, this._mod[modName])
            }

            // Call DOM init handlers
            this._domInit()

            // Compontent rendered at least once
            this._renderedOnce = true
        }

        return this
    },

    /**
     * Creates DOM-node for child with @index and appends to DOM tree
     *
     * @index number Child index
     */
    _renderChildWithIndex: function (index) {
        var child = this._children[index]

        if (child instanceof BemNode) {
            child.render()
        } else {
            this._domNode.appendChild(
                document.createTextNode(child)
            )
        }
    },

    /**
     * Change children array to expanded children array
     * after node expanding
     */
    _completeExpand: function () {
        if (this._isExpandContext && this._expandedChildren) {
            this._children = this._expandedChildren
            this._expandedChildren = null
        }
        this._isExpanded = true
    },

    /**
     * Initial instructions for the DOM-element
     */
    _domInit: function () {
        var decl = this._decl
        if (decl) {
            decl.commonDomInit && decl.commonDomInit.call(this)
        }

        if (this._implementedNode && (decl = this._implementedNode._decl)) {
            decl.commonDomInit && decl.commonDomInit.call(this)
        }

        this._domInited = true

        if (this._afterDomInitHandlers.length !== 0) {
            for (var i = 0, ii = this._afterDomInitHandlers.length; i < ii; i++) {
                this._afterDomInitHandlers[i].call(this)
            }
        }
    },

    /**
     * Call modifier change handlers
     *
     * @modName  string
     * @modValue string
     * @data     object Additional data for handler
     */
    _callModHandlers: function (modName, modValue, data, context) {
        var handlers

        if (this._modHandlers[modName]) {
            if (this._modHandlers[modName][modValue]) {
                handlers = this._modHandlers[modName][modValue]
            } else if (modValue === false && this._modHandlers[modName]['']) {
                handlers = this._modHandlers[modName]['']
            } else if (modValue === '' && this._modHandlers[modName][false]) {
                handlers = this._modHandlers[modName][false]
            }
            if (this._modHandlers[modName]['*']) {
                if (handlers) {
                    handlers = handlers.concat(this._modHandlers[modName]['*'])
                } else {
                    handlers = this._modHandlers[modName]['*']
                }
            }
        }

        if (handlers) {
            if (typeof context === 'undefined') context = this
            for (var i = 0, ii = handlers.length; i < ii; i++) {
                handlers[i].call(context, data)
            }
        }

        if (this._implementedNode) {
            this._implementedNode._callModHandlers(modName, modValue, data, this)
        }
    },

    /**
     * Sets DOM classes
     */
    _setDomNodeClasses: function (returnClassNameOnly) {
        var className = this._name
        var value
        var tail

        for (var i = 0, ii = this._mix.length; i < ii; i++) {
            className += ' ' + this._mix[i]
        }

        for (var key in this._mod) {
            value = this._mod[key]
            if (value === '' || value === false) continue

            tail = value === true
                ? '_' + key
                : '_' + key + '_' + value

            className += ' ' + this._name + tail

            for (var i = 0, ii = this._mix.length; i < ii; i++) {
                className += ' ' + this._mix[i] + tail
            }
        }

        if (this._implementedNode) {
            className += ' ' + this._implementedNode._setDomNodeClasses(true)
        }

        if (returnClassNameOnly) {
            return className
        } else {
            if (this._domNode) {
                this._domNode.className = className
            }
        }
    },

    /**
     * Sets DOM CSS
     */
    _setDomNodeCSS: function () {
        var css = ''

        for (var name in this._css) {
            if (this._css[name] || this._css[name] === 0) {
                css += name + ':' + this._css[name] + ';'
            }
        }

        if (css !== '') this._domNode.setAttribute('style', css)
    },

    /**
     * Conerts BemNode with its children to string of Beast.node() functions
     * @return string
     */
    toStringOfFunctions: function () {
        var attr = '{'
        for (var key in this._mod) {
            attr += '"'+ (key.substr(0,1).toUpperCase() + key.slice(1)) +'":"'+ this._mod[key] +'",'
        }
        for (var key in this._param) {
            if (typeof this._param[key] === 'string' || typeof this._param[key] === 'number') {
                attr += '"'+ key +'":"'+ this._param[key] +'",'
            }
        }
        attr += '}'

        var children = ''
        for (var i = 0, ii = this._children.length; i < ii; i++) {
            if (this._children[i] instanceof BemNode) {
                children += this._children[i].toStringOfFunctions()
            } else {
                children += '"'+ this._children[i].toString().replace(ReDoubleQuote, '\\"') +'"'
            }

            if (i < ii - 1) {
                children += ','
            }
        }

        return 'Beast.node(' +
            '"'+ this._nodeName + '",' +
            (attr === '{}' ? 'null' : attr) +
            (children ? ',' + children + ')' : ')')
    },

    /**
     * Gets HTML text for current node and its children.
     *
     * @return string
     */
    renderHTML: function () {
        var html = ''

        //TODO: Some recursive routine here

        return html
    },

    /**
     * Calls expand declaration in runtime
     */
    expand: function () {
        // Replace old children
        this.empty()

        // Append new children without DOM-node creating (_isReplaceContext flag)
        this._isReplaceContext = true
        this.append.apply(this, arguments)

        // Call expand function
        if (this._decl && this._decl.expand) {
            this._isExpandContext = true
            this._decl.expand.call(this)
            this._completeExpand()
            this._isExpandContext = false
        }

        this._isReplaceContext = false

        // Render children
        for (var i = 0, ii = this._children.length; i < ii; i++) {
            this._renderChildWithIndex(i)
        }

        // Call domInit function
        if (this._decl && this._decl.domInit) {
            this._decl.domInit.call(this)
        }

        // Call implemented domInit function
        if (this._implementedNode &&
            this._implementedNode._decl &&
            this._implementedNode._decl.domInit) {
            this._implementedNode._decl.domInit.call(this)
        }

        return this
    }
}

})();

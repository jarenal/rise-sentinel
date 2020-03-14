const settings = require("./settings");
const mainnet = require('risejs').rise;
const _ = require('lodash');
const io = require('socket.io')(settings.port);
const log4js = require("log4js");
let mainnetHeight = 0;
let nodes = {};

log4js.configure({
    appenders: {
        console: { type: 'console', layout: {type: 'basic'} }
    }, 
    categories: {
        default: { appenders: ['console'], level: 'debug' }
    }
});
const logger = log4js.getLogger('default');

io.on('connection', (socket) => {
    const socketId = socket.id;
    logger.info('New client \'' + socketId + '\' connected!');

    socket.on('greeting', (node) => {
        logger.debug('greeting', node);

        const riseClient = require('risejs').dposAPI.newWrapper(node.delegateEndpoint);

        nodes[socketId] = {...node, pings: 0, fails: 0, socket: socket, riseClient: riseClient};

        // Check node
        const nodeInterval = setInterval(() => {
            logger.debug('------------------------------------------------------------------');
            logger.debug('[' + nodeAlias + '] Checking client: alias=' + nodes[socketId].alias + ', role=' + nodes[socketId].role + ', pings=' + nodes[socketId].pings + ', fails=' + nodes[socketId].fails);
            logger.debug('------------------------------------------------------------------');
            let nodeAlias = nodes[socketId].alias;
            mainnet.blocks
            .getHeight()
            .then(function(response) {
                if (typeof response.height === 'undefined') {
                    logger.error('[' + nodeAlias + '] Mainnet connection error');
                    return;
                }
                mainnetHeight = response.height;
                nodes[socketId].riseClient.blocks
                .getHeight()
                .then(function(response) {
                    logger.debug('[' + nodeAlias + '] Mainnet height: ', mainnetHeight);
                    logger.debug('[' + nodeAlias + '] Client height: ', response.height);
                    nodes[socketId].pings++;
                    if (mainnetHeight > response.height || typeof response.height === 'undefined') {
                        nodes[socketId].fails++;
                    } else {
                        nodes[socketId].fails = 0;
                    }
                })
                .catch(function(err) {
                    logger.error('[' + nodeAlias + '] Client connection error');
                    nodes[socketId].fails++;
                });                
            })
            .catch(function(err) {
                logger.error('[' + nodeAlias + '] Mainnet connection error');
            });    
        }, settings.checkClientInterval);

        nodes[socketId].interval = nodeInterval;
    });

    socket.on('disconnect', () => {
        logger.error('Client \'' + socket.id + '\' disconnected');
        clearInterval(nodes[socketId].interval);
        delete nodes[socket.id];
    });

});

// Promote / demote nodes
setInterval(() => {
    let demote_slave;
    let slaves = [];

    logger.debug('Total clients connected: ', Object.keys(nodes).length);
    _.map(nodes, (node, socketId) => {
        if (node.fails < 3 && node.pings >= 3 && node.role === "slave") {
            slaves.push(node);
        }
        if (node.fails >= 3 && node.role === "master") {
            demote_slave = node;
        }
    })

    if (!_.isEmpty(demote_slave) && slaves.length > 0) {
        logger.info('--- [' + demote_slave.alias + '] demoted!');
        let promote_master = slaves[_.random(slaves.length - 1)];
        logger.info('+++ [' + promote_master.alias + '] promoted!');
        demote_slave.socket.emit("demote", "");
        nodes[demote_slave.socket.id].role = "slave";
        promote_master.socket.emit("promote", "");
        nodes[promote_master.socket.id].role = "master";
    } else {
        logger.debug('Nothing for to promote or demote');
    }
}, settings.failOverInterval);
'use strict';

var fs = require('fs');
var path = require('path');
var z_schema = require('./z_schema.js');
var configSchema = require('../schema/config.js');

const program = require('commander');
const randomstring = require('randomstring');
const _ = require('lodash');


const rootPath = path.dirname(path.resolve(__filename, '..'));

/**
 * Loads config.json file
 * @memberof module:helpers
 * @implements {validateForce}
 * @param {Object} packageJson
 * @param {Boolean} parseCommandLineOptions - Should parse the command line options or not
 * @returns {Object} configData
 */
function Config (packageJson, parseCommandLineOptions = true) {
    program
        .version(packageJson.version)
        .option('-c, --config <path>', 'config file path')
        .option(
            '-n, --network [network]',
            'ADAMANT network [devnet|mainnet|testnet]. Defaults to "devnet"'
        )
        .option('-p, --port <port>', 'listening port number')
        .option('-a, --address <ip>', 'listening host name or ip')
        .option('-x, --peers [peers...]', 'peers list')
        .option('-l, --log <level>', 'log level')
        .option('-s, --snapshot <round>', 'verify snapshot')
        .parse(process.argv);
    if (parseCommandLineOptions) {
        program.parse(process.argv);
    }
    const network = program.network || process.env.ADAMANT_NETWORK || 'devnet';

    const genesisBlock = loadJSONFile(`./config/${network}/genesisBlock.json`);

    const defaultConstants = require('../config/default/constants.js');
    const customConstants = require(`../config/${network}/constants.js`); // eslint-disable-line import/no-dynamic-require

    const defaultExceptions = require('../config/default/exceptions.js');
    const customExceptions = require(`../config/${network}/exceptions.js`); // eslint-disable-line import/no-dynamic-require

    const defaultConfig = loadJSONFile('config/default/config.json');
    const customConfig = loadJSONFile(
        program.config ||
        process.env.ADAMANT_CONFIG_FILE ||
        `config/${network}/config.json`
    );

    const runtimeConfig = {
        network,
        root: rootPath,
        nonce: randomstring.generate(16),
        version: packageJson.version,
        minVersion: packageJson.config.minVersion,
        nethash: genesisBlock.payloadHash,
    };

    let commandLineConfig = {
        port: +program.port || process.env.ADAMANT_HTTP_PORT || null,
        address: program.address,
        consoleLogLevel: program.log || process.env.ADAMANT_CONSOLE_LOG_LEVEL,
        db: { database: program.database },
        loading: { snapshotRound: program.snapshot },
        peers: {
            list: extractPeersList(
                program.peers || process.env.ADAMANT_PEERS,
                +program.port ||
                process.env.ADAMANT_HTTP_PORT ||
                customConfig.port ||
                defaultConfig.port
            ),
        },
        coverage: process.env.NODE_ENV === 'test',
    };
    commandLineConfig = cleanDeep(commandLineConfig);

    const appConfig = _.merge(
        defaultConfig,
        customConfig,
        runtimeConfig,
        commandLineConfig
    );

    var validator = new z_schema();
    var valid = validator.validate(appConfig, configSchema.config);

    if (!valid) {
        console.error('Failed to validate config data', validator.getLastErrors());
        process.exit(1);
    } else {
        appConfig.genesisBlock = genesisBlock;

        appConfig.constants = _.merge(defaultConstants, customConstants);

        appConfig.exceptions = _.merge(defaultExceptions, customExceptions);

        validateForce(appConfig);

        return appConfig;
    }
}

function loadJSONFile (filePath) {
    try {
        filePath = path.resolve(rootPath, filePath);
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        console.error(`Failed to load file: ${filePath}`);
        console.error(err.message);
        process.exit(1);
    }
}

function extractPeersList (peers, defaultPort) {
    if (typeof peers === 'string') {
        return peers.split(',').map(peer => {
            peer = peer.split(':');
        return {
            ip: peer.shift(),
            wsPort: peer.shift() || defaultPort,
        };
    });
    }
    return [];
}

function cleanDeep (
    object,
    {
        emptyArrays = true,
        emptyObjects = true,
        emptyStrings = true,
        nullValues = true,
        undefinedValues = true,
    } = {}
) {
    return _.transform(object, (result, value, key) => {
        // Recurse into arrays and objects.
        if (Array.isArray(value) || _.isPlainObject(value)) {
        value = cleanDeep(value, {
            emptyArrays,
            emptyObjects,
            emptyStrings,
            nullValues,
            undefinedValues,
        });
    }

    // Exclude empty objects.
    if (emptyObjects && _.isPlainObject(value) && _.isEmpty(value)) {
        return;
    }

    // Exclude empty arrays.
    if (emptyArrays && Array.isArray(value) && !value.length) {
        return;
    }

    // Exclude empty strings.
    if (emptyStrings && value === '') {
        return;
    }

    // Exclude null values.
    if (nullValues && value === null) {
        return;
    }

    // Exclude undefined values.
    if (undefinedValues && value === undefined) {
        return;
    }

    // Append when recursing arrays.
    if (Array.isArray(result)) {
        return result.push(value);
    }

    result[key] = value;
});
}

/**
 * Validates nethash value from constants and sets forging force to false if any.
 * @private
 * @param {Object} configData 
 */
function validateForce (configData) {
	if (configData.forging.force) {
		var index = configData.constants.nethashes.indexOf(configData.nethash);

		if (index !== -1) {
			console.log('Forced forging disabled for nethash', configData.nethash);
			configData.forging.force = false;
		}
	}
}

// Exports
module.exports = Config;

'use strict';

const fs = require('fs');
const os = require('os');
const streamPromise = require('stream-promise');
const fse = require('fs-extra');
const isStandaloneExecutable =
  require('../../utils/isStandaloneExecutable') && process.platform !== 'win32';
const isInChina = require('@serverless/utils/is-in-china');
const currentVersion = require('../../../package').version;
const fetch = require('node-fetch');

const BINARIES_DIR_PATH = `${os.homedir()}/.serverless/bin`;
const BINARY_TMP_PATH = `${BINARIES_DIR_PATH}/serverless-tmp`;
const BINARY_PATH = `${BINARIES_DIR_PATH}/serverless`;

module.exports = class Standalone {
  constructor(serverless) {
    this.serverless = serverless;

    this.commands = {
      upgrade: {
        isHidden: !isStandaloneExecutable,
        usage: 'Upgrade Serverless',
        lifecycleEvents: ['upgrade'],
      },
      uninstall: {
        isHidden: !isStandaloneExecutable,
        usage: 'Uninstall Serverless',
        lifecycleEvents: ['uninstall'],
      },
    };

    this.hooks = {
      'upgrade:upgrade': () => {
        return isStandaloneExecutable ? this.upgrade() : this.rejectCommand('upgrade');
      },
      'uninstall:uninstall': () => {
        return isStandaloneExecutable ? this.uninstall() : this.rejectCommand('uninstall');
      },
    };
  }

  upgrade() {
    return fetch(
      isInChina
        ? 'https://sls-standalone-1300963013.cos.ap-shanghai.myqcloud.com/latest-tag'
        : 'https://api.github.com/repos/serverless/serverless/releases/latest'
    )
      .then(response => {
        if (!response.ok) {
          throw new this.serverless.classes.Error(
            'Sorry unable to `upgrade` at this point ' +
              `(server rejected request with ${response.status})`
          );
        }
        if (isInChina) return response.text();
        return response.json().then(({ tag_name: tagName }) => tagName);
      })
      .then(tagName => {
        const latestVersion = tagName.slice(1);
        if (latestVersion === currentVersion) {
          this.serverless.cli.log('Already at latest version');
          return null;
        }
        const platform = (() => {
          switch (process.platform) {
            case 'darwin':
              return 'macos';
            default:
              return process.platform;
          }
        })();
        const arch = (() => {
          switch (process.arch) {
            case 'x32':
              return 'x86';
            case 'arm':
            case 'arm64':
              return 'armv6';
            default:
              return process.arch;
          }
        })();
        this.serverless.cli.log('Downloading new version...');
        const executableUrl = isInChina
          ? `https://sls-standalone-1300963013.cos.ap-shanghai.myqcloud.com/${tagName}/` +
            `serverless-${platform}-${arch}`
          : `https://github.com/serverless/serverless/releases/download/${tagName}/` +
            `serverless-${platform}-${arch}`;
        return fetch(executableUrl)
          .then(response => {
            if (!response.ok) {
              throw new this.serverless.classes.Error(
                'Sorry unable to `upgrade` at this point ' +
                  `(server rejected request with ${response.status})`
              );
            }
            return streamPromise(response.body.pipe(fs.createWriteStream(BINARY_TMP_PATH)))
              .then(() => fse.rename(BINARY_TMP_PATH, BINARY_PATH))
              .then(() => fse.chmod(BINARY_PATH, 0o755));
          })
          .then(() => this.serverless.cli.log(`Successfully upgraded to ${tagName}`));
      });
  }

  uninstall() {
    return fse.remove(BINARIES_DIR_PATH).then(() => this.serverless.cli.log('Uninstalled'));
  }

  rejectCommand(command) {
    throw new this.serverless.classes.Error(
      `\`${command}\` command is supported only in context of a standalone executable instance ` +
        'in non Windows environment.'
    );
  }
};

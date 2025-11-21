/**
 * 将翻译文件集合到dist目录
 */
const path = require('path');
const fs = require('fs-extra');
const scannerConfig = require('../config/i18next-scanner.config');
// const utils = require('./utils');
const langs = scannerConfig.options.lngs;
const distDir = path.resolve(__dirname, '../../');
// const plugins = utils.getPluginDirs();

const filepath = [
  path.resolve(__dirname, '../../shared/i18n/langs/{{lang}}/translation.json'),
  // ...plugins.map((plugin) =>
  //   path.resolve(
  //     __dirname,
  //     `../../src/plugins/${plugin}/i18n/{{lang}}/translation.json`
  //   )
  // ),
];

// 添加现有的locales文件作为基础
const existingLocalesPath = path.resolve(__dirname, '../../locales/{{lang}}/translation.json');

console.log('Build locales:', langs);
for (const lang of langs) {
  const existingPath = existingLocalesPath.replace('{{lang}}', lang);
  
  // 先读取现有的locales文件（如果存在）
  const readExistingLocales = fs.pathExists(existingPath)
    .then(exists => exists ? fs.readJSON(existingPath) : {});
  
  Promise.all([
    readExistingLocales,
    ...filepath
      .map((p) => {
        return p.replace('{{lang}}', lang);
      })
      .map((p) => fs.readJSON(p).catch(() => ({}))) // 如果文件不存在，返回空对象
  ])
    .then((jsons) => {
      let res = {};
      for (const json of jsons) {
        res = {
          ...res,
          ...json,
        };
      }

      return res;
    })
    .then((trans) => {
      const filePath = path.resolve(
        distDir,
        `./locales/${lang}/translation.json`
      );
      return fs.ensureFile(filePath).then(() => {
        fs.writeJSON(filePath, trans, {
          spaces: 2,
        });
      });
    })
    .then(() => {
      console.log(`Build Translation [${lang}] Success!`);
    })
    .catch((err) => {
      console.error(`Build Translation [${lang}] Failed:`, err);
    });
}

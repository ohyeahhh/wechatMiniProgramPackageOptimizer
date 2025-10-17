import fs from 'fs';
import path from 'path';
import type { Plugin } from 'vite';

interface Options {
  distDir?: string;
  copyComponentDirName?: string;
  logFilePath?: string;
  enableDetailedConsoleLog?: boolean;
  enable?: boolean;
}

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const logs: string[] = [];

export default function miniProgramPackageOptimizer(options: Options = {}): Plugin {
  if (options.enable === false) {
    return { name: 'mini-program-package-optimizer' };
  }
  // 初始化配置参数
  const DIST_DIR = options.distDir || process.env.UNI_OUTPUT_DIR || '';
  if (!DIST_DIR) throw new Error('DIST_DIR is required');
  const COMMON_COMPONENTS_DIR_NAME = 'components';
  const copyComponentDirName = options.copyComponentDirName || 'sharedComponents';

  // 日志输出相关
  const logFilePath = options.logFilePath || path.join(DIST_DIR, '../../', 'miniProgramPackageOptimizer.log');
  const enableDetailedConsoleLog = options.enableDetailedConsoleLog ?? false; // 默认为false
  const originalConsoleLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = (...args: any[]) => {
    const msg = args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg, null, 2))).join(' ');
    logs.push(msg);
    if (enableDetailedConsoleLog) {
      originalConsoleLog(...args);
    }
  };
  console.warn = (...args) => {
    const msg = '[WARN] ' + args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg, null, 2))).join(' ');
    logs.push(msg);
    if (enableDetailedConsoleLog) {
      originalWarn(...args);
    }
  };
  console.error = (...args) => {
    const msg = '[ERROR] ' + args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg, null, 2))).join(' ');
    logs.push(msg);
    originalError(...args);
    fs.writeFileSync(logFilePath, logs.join('\n'), 'utf-8');
    console.log = originalConsoleLog; // 可选：恢复原始 log 方法
    originalConsoleLog('📝 [日志输出] 所有 log 已写入：', logFilePath);
  };

  let jsonCount = 0;
  let fileCount = 0;
  let replaceCount = 0;
  let deleteCount = 0;

  console.log('🔧 [miniProgramPackageOptimizer] 插件初始化完成，配置:', {
    DIST_DIR,
    copyComponentDirName,
    logFilePath,
    enableDetailedConsoleLog,
  });

  return {
    name: 'mini-program-package-optimizer',
    apply: 'build',
    writeBundle(_, bundle) {
      console.log('📦 [Task] 开始执行小程序包优化...');

      // 设置组件目录路径
      const COMPONENTS_DIR = path.join(DIST_DIR, COMMON_COMPONENTS_DIR_NAME);
      console.log('📁 [Task] 组件目录设置:', COMPONENTS_DIR);

      // 扫描所有子包目录（以'sub'开头的目录）
      const appJsonPath = path.join(DIST_DIR, 'app.json');
      const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf-8'));
      jsonCount++;
      let SUBPACKAGES: string[] = [];
      try {
        SUBPACKAGES = (appJson.subPackages || []).map((pkg: { root: string }) => pkg.root);
      } catch (error) {
        console.error('Failed to read or parse app.json:', error);
        throw new Error('Unable to determine subpackages from app.json');
      }
      console.log('📋 [Task] 发现子包:', SUBPACKAGES);

      // 定义MAINPACKAGES页面目录
      // Get main package pages from app.json
      const MAINPACKAGES = appJson.pages?.map((page: string) => page.split('/')[0]) || ['pages'];

      // 初始化组件使用情况追踪
      const usedByMain = new Set<string>(); // 主包使用的组件
      const usedBySub = new Map<string, Set<string>>(); // 各子包使用的组件
      const usedByBrothers = new Map<string, Set<string>>(); // COMPONENTS_DIR公共组件目录下的组件，被公共组件目录下其他公共组件引用的记录
      const usedBrothers = new Map<string, Set<string>>(); //COMPONENTS_DIR公共组件目录下的组件，引用了公共组件目录下其他公共组件的记录
      console.log('🔍 [Task] 初始化组件使用情况追踪数据结构');

      // 从JSON文件中收集公共组件使用情况的工具函数
      function collectUsageFromJson(filePath: string, consumer: (p: string) => void) {
        // console.log('📄 [collectUsageFromJson] 分析文件:', filePath);
        const content = fs.readFileSync(filePath, 'utf-8');
        try {
          const json = JSON.parse(content);
          if (json.usingComponents) {
            const componentPaths = Object.values<string>(json.usingComponents);
            // console.log('🔗 [collectUsageFromJson] 发现组件引用:', componentPaths);
            componentPaths.forEach(compPath => {
              const resolved = path.resolve(path.dirname(filePath), compPath);
              if (resolved.includes(`${COMPONENTS_DIR}/`)) {
                // console.log('✅ [collectUsageFromJson] 有效组件路径:', resolved);
                // 不需要记录组件的完整路径resolved，只需要记住组件对应的COMPONENTS_DIR内组件名/目录名
                const componentDir = resolved.replace(
                  new RegExp(`(${COMPONENTS_DIR}/)([^\/]+)([\/]?)(.*)`),
                  (_, componentDir, brotherName) => {
                    return `${componentDir}${brotherName}`;
                  },
                );
                // 如果引用的组件目录包含当前json文件，说明是组件内引用，不是外部组件引用
                if (filePath.includes(componentDir)) {
                  return;
                }
                consumer(componentDir);
              } else {
                // console.log('⏭️ [collectUsageFromJson] 跳过非组件路径:', resolved);
              }
            });
          } else {
            // console.log('📝 [collectUsageFromJson] 文件无组件引用:', filePath);
          }
        } catch (e) {
          console.warn('⚠️ [collectUsageFromJson] JSON解析错误:', filePath, e);
        }
      }

      // 递归遍历目录中所有JSON文件的工具函数
      function walkJsonFiles(dir: string, cb: (file: string) => void) {
        // console.log('🚶 [walkJsonFiles] 遍历目录:', dir);
        const entries = fs.readdirSync(dir);
        // console.log('📂 [walkJsonFiles] 目录内容:', entries);
        for (const entry of entries) {
          const full = path.join(dir, entry);
          if (fs.statSync(full).isDirectory()) {
            // console.log('📁 [walkJsonFiles] 进入子目录:', full);
            walkJsonFiles(full, cb);
          } else if (entry.endsWith('.json')) {
            // console.log('📄 [walkJsonFiles] 处理JSON文件:', full);
            cb(full);
            jsonCount++;
          }
        }
      }

      function copyDirRecursive(src: string, dest: string) {
        const stat = fs.statSync(src);
        if (stat.isDirectory()) {
          fs.mkdirSync(dest, { recursive: true });
          const entries = fs.readdirSync(src);
          for (const entry of entries) {
            const srcPath = path.join(src, entry);
            const destPath = path.join(dest, entry);
            copyDirRecursive(srcPath, destPath);
          }
        } else {
          fs.copyFileSync(src, dest);
        }
      }

      // 扫描公共组件目录
      console.log('📁 [Task] 开始扫描公共组件目录:', COMPONENTS_DIR);
      const allComponentDirs = fs
        .readdirSync(COMPONENTS_DIR)
        .map(d => path.join(COMPONENTS_DIR, d))
        .filter(p => fs.statSync(p).isDirectory());
      console.log(
        '📋 [Task] 发现组件目录:',
        allComponentDirs.map(d => path.basename(d)),
      );

      // 检查当前组件使用COMPONENTS_DIR内其他组件的情况
      // 顺便记录COMPONENTS_DIR内组件被COMPONENTS_DIR内其他组件引用的情况
      console.log('🔍 [Task] 开始收集公共组件间引用情况...');
      for (const compDir of allComponentDirs) {
        // const compName = path.basename(compDir);
        const usedBrothersSet = new Set<string>();
        usedBrothers.set(compDir, usedBrothersSet);
        walkJsonFiles(compDir, file => {
          collectUsageFromJson(file, comp => {
            // const brotherName = path.basename(comp);
            usedBrothersSet.add(comp);
            let usedByBrothersOfComp = usedByBrothers.get(comp);
            if (!usedByBrothersOfComp) {
              usedByBrothersOfComp = new Set<string>();
              usedByBrothers.set(comp, usedByBrothersOfComp);
            }
            usedByBrothersOfComp.add(compDir);
          });
        });
      }
      for (const compDir of allComponentDirs) {
        // const compName = path.basename(compDir);
        const usedByBrothersOfComp = usedByBrothers.get(compDir);
        const usedBrothersOfComp = usedBrothers.get(compDir);
        console.log(
          '✅ 公共组件',
          path.basename(compDir),
          `被${usedByBrothersOfComp?.size || 0}个公共组件引用，引用了${usedBrothersOfComp?.size || 0}个公共组件`,
          usedByBrothersOfComp?.size
            ? `\n被公共组件引用：${[...usedByBrothersOfComp].map(b => path.basename(b)).join(', ')}`
            : '',
          usedBrothersOfComp?.size
            ? `\n引用了公共组件：${[...usedBrothersOfComp].map(b => path.basename(b)).join(', ')}`
            : '',
        );
      }
      console.log('✅ [Task] 公共组件间引用情况收集完成');

      // 收集主包中的组件引用
      console.log('🏠 [Task] 开始收集主包组件引用...');

      // Analyze component usage in main packages
      for (const mainPkg of MAINPACKAGES) {
        const mainPkgPath = path.join(DIST_DIR, mainPkg);
        walkJsonFiles(mainPkgPath, file => {
          collectUsageFromJson(file, comp => {
            usedByMain.add(comp);
          });
        });
      }
      console.log(
        '✅ [Task] 主包组件直接引用，共',
        usedByMain.size,
        '个组件, 包括\n',
        [...usedByMain].map(b => path.basename(b)).join(',\n '),
      );
      usedByMain.forEach(comp => {
        const usedBrothersOfComp = usedBrothers.get(comp);
        if (usedBrothersOfComp && (usedBrothersOfComp?.size || 0) > 0) {
          usedBrothersOfComp.forEach(brother => {
            usedByMain.add(brother);
          });
          console.log(
            `✅ [Task] 主包组件引用的${path.basename(comp)}组件，引用了组件共`,
            usedBrothersOfComp.size,
            '个, 包括\n',
            [...usedBrothersOfComp].map(b => path.basename(b)).join(',\n '),
          );
        }
      });
      console.log(
        '✅ [Task] 主包组件引用收集完成，共',
        usedByMain.size,
        '个组件, 包括',
        [...usedByMain].map(b => path.basename(b)).join(', '),
      );

      // 收集各子包中的组件引用
      console.log('📦 [Task] 开始收集子包组件引用...');
      for (const sub of SUBPACKAGES) {
        console.log('🔍 [子包收集] 处理子包.json文件:', sub);
        const subSet = new Set<string>();
        usedBySub.set(sub, subSet);
        // 子包路径 => 替换表（旧路径 => 新路径）

        walkJsonFiles(path.join(DIST_DIR, sub), file => {
          // console.log('📄 [子包收集] 分析子包文件:', file);
          collectUsageFromJson(file, comp => {
            // console.log('➕ [子包收集] 添加到子包', sub, '使用列表:', comp);
            subSet.add(comp);
          });
        });
        subSet.forEach(comp => {
          const usedBrothersOfComp = usedBrothers.get(comp);
          if (usedBrothersOfComp && (usedBrothersOfComp?.size || 0) > 0) {
            usedBrothersOfComp.forEach(brother => {
              // console.log('✅ [Task] 子包引用的公共组件', path.basename(comp), '引用了公共组件', brother);
              subSet.add(brother);
            });
          }
        });
        console.log(
          '✅ [子包收集] 子包',
          sub,
          '组件引用收集完成，共',
          subSet.size,
          '个组件，包括',
          [...subSet].map(b => path.basename(b)).join(', '),
        );
      }

      // 遍历每个组件目录，进行复制和删除
      console.log('🔄 [Task] 开始遍历每个组件目录，进行复制和删除...');
      for (const compDir of allComponentDirs) {
        const compName = path.basename(compDir);
        // 检查被哪些子包使用
        const usedInSubs: string[] = [];
        for (const [sub, set] of usedBySub.entries()) {
          if ([...set].some(p => p.startsWith(compDir))) {
            usedInSubs.push(sub);
            // console.log('📦 [组件分析] 组件', compName, '被子包使用:', sub);
          }
        }

        // 为每个使用该组件的子包复制组件
        console.log('📋 [组件复制] 组件', compName, '需要复制到子包:', usedInSubs);
        for (const sub of usedInSubs) {
          // console.log('📦 [组件复制] 开始为子包', sub, '复制组件', compName);
          const target = path.join(DIST_DIR, sub, copyComponentDirName, compName);
          // console.log('� [组件复制] 目标路径:', target);

          // 创建目标目录
          fs.mkdirSync(target, { recursive: true });
          // console.log('✅ [组件复制] 目标目录创建成功', target);

          // 复制组件文件
          copyDirRecursive(compDir, target);

          console.log('✅ [组件复制] 组件', compName, '复制到子包', sub, '完成', `（${target}）`);
        }

        // 检查是否被主包使用
        const usedInMain = [...usedByMain].some(p => p.startsWith(compDir));
        // console.log('🏠 [组件分析] 组件', compName, '是否被主包使用:', usedInMain);
        // 如果被主包使用，跳过处理（保持在主包中）
        if (usedInMain) {
          console.log('🗑️ [组件清理] 组件', compName, '被主包使用，不删除');
          continue;
        }
        // 如果未被主包引用，删除原始组件
        // Delete files recursively with validation
        const remainFiles: string[] = [];
        const deleteFilesRecursively = (dir: string) => {
          const entries = fs.readdirSync(dir);

          for (const entry of entries) {
            const fullPath = path.join(dir, entry);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
              deleteFilesRecursively(fullPath);
            } else {
              const ext = path.extname(fullPath).toLowerCase();
              const validExts = ['.json', '.js', '.wxml', '.wxss'];

              if (validExts.includes(ext)) {
                if (ext === '.js') {
                  // Check if corresponding .json exists
                  const jsonPath = fullPath.replace('.js', '.json');
                  // 如果不存在同名json文件，则说明这是一个独立的js文件，非组件文件，目前非组件都直接保留，免得里面定义了一些枚举、方法等，被主包用到
                  if (fs.existsSync(jsonPath)) {
                    fs.unlinkSync(fullPath);
                  } else {
                    remainFiles.push(fullPath);
                  }
                } else {
                  fs.unlinkSync(fullPath);
                }
              }
            }
          }

          // Remove empty directory after processing files
          if (fs.readdirSync(dir).length === 0) {
            fs.rmdirSync(dir);
          }
        };
        deleteFilesRecursively(compDir);
        // fs.rmSync(compDir, { recursive: true, force: true });

        deleteCount++;
        console.log(
          '🗑️ [组件清理] 组件',
          compName,
          `未被主包使用，${remainFiles.length > 0 ? '以下文件非组件文件仍保留在主包：' : '组件目录删除完成。'}`,
          remainFiles.length > 0 ? remainFiles : '',
        );
      }

      function walkAllFiles(
        dir: string,
        params?: any,
        onDir?: (path: string) => {
          skip?: boolean | void;
          newParams?: any;
        },
        onFile?: (path: string, params?: any) => void,
      ) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const entryPath = path.join(dir, entry.name);
          const isDir = entry.isDirectory();
          if (isDir) {
            if (onDir) {
              const { skip, newParams } = onDir(entryPath) || {};
              if (skip) continue;
              walkAllFiles(entryPath, newParams, onDir, onFile);
            } else {
              walkAllFiles(entryPath, undefined, undefined, onFile);
            }
          } else {
            onFile && onFile(entryPath, params);
            fileCount++;
          }
        }
      }
      //为子包中所有文件替换路径，主要思路是，递归遍历子包下的目录及文件，如果是目录，计算当前目录相对于子包当中的sharedComponents的路径，定义为newPath，然后再计算当前目录相对主包/components目录的路径，定义为oldPath，然后遍历当前目录下的文件，匹配到oldPath则替换成newPath
      SUBPACKAGES.forEach(sub => {
        if ((usedBySub.get(sub)?.size || 0) > 0) {
          console.log('📦 [组件替换] 开始为子包', sub, `替换引用公共组件路径指向->${sub}/${copyComponentDirName}`);
          const subPackagePath = path.join(DIST_DIR, sub);
          const allCopyComponentNames = Array.from(usedBySub.get(sub) || []).map(p => path.basename(p));
          const relativeToMain = path.join(
            path.relative(subPackagePath, DIST_DIR).replace(/\\/g, '/'),
            COMMON_COMPONENTS_DIR_NAME,
          );
          let relativeToShared = path
            .relative(subPackagePath, path.join(subPackagePath, copyComponentDirName))
            .replace(/\\/g, '/');
          if (relativeToShared.indexOf('../') === -1) {
            relativeToShared = './' + relativeToShared;
          }
          walkAllFiles(
            subPackagePath,
            {
              // 计算当前目录相对主包 components 的路径
              relativeToMain,

              // 计算当前目录相对子包copyComponentDirName 的路径
              relativeToShared,
            },
            entryPath => {
              if (entryPath.includes(copyComponentDirName)) return { skip: true };
              // 计算主包 component相对当前目录 的路径
              const relativeToMain = path.join(
                path.relative(entryPath, DIST_DIR).replace(/\\/g, '/'),
                COMMON_COMPONENTS_DIR_NAME,
              );
              // 计算子包copyComponentDirName 相对当前目录的路径
              const relativeToShared = path
                .relative(entryPath, path.join(subPackagePath, copyComponentDirName))
                .replace(/\\/g, '/');
              console.log(
                '🔄 [walk] 处理目录:',
                entryPath,
                '\n相对主包路径:',
                relativeToMain,
                '\n相对子包路径:',
                relativeToShared,
              );
              return { newParams: { relativeToMain, relativeToShared } };
            },
            (entryPath, params) => {
              if (!params) return;
              const ext = path.extname(entryPath).toLowerCase();
              if (!['.json', '.js'].includes(ext)) return;
              const fileContent = fs.readFileSync(entryPath, 'utf-8');
              // 替换形式如 "../../../components" → "../../sharedComponents"
              const { relativeToMain, relativeToShared } = params;
              console.log('beforeMatch', { entryPath, relativeToMain, relativeToShared });
              const replaced = fileContent.replace(
                new RegExp(`(["'])(${relativeToMain})([^"'\\\n]+)(["'])`, 'g'),
                fullMatch => {
                  console.log('fullMatch', { fullMatch, relativeToMain, relativeToShared });
                  const newContent = fullMatch.replace(relativeToMain, relativeToShared);
                  return `${newContent}`;
                },
              );
              if (replaced !== fileContent) {
                fs.writeFileSync(entryPath, replaced, 'utf-8');
                console.log(`✅ 替换路径: ${entryPath}`);
                replaceCount++;
              }
            },
          );

          console.log('📦 [路径替换] 开始为子包', sub, `的拷贝组件内各个文件对主包资源的引用路径进行更新`);
          const copyComponentDir = path.join(subPackagePath, copyComponentDirName);
          // 从主包components回到根
          const fromComponentsToRoot = path.relative(COMPONENTS_DIR, DIST_DIR);
          // 从子包的copyComponentDir回到根
          const fromCopyComponentsToRoot = path.relative(copyComponentDir, DIST_DIR);
          console.log(`准备修改公共组件引用了主包其他文件的路径:${fromComponentsToRoot}->${fromCopyComponentsToRoot}`);

          walkAllFiles(
            copyComponentDir,
            undefined,
            entryPath => {
              const dirPathOld = entryPath.replace(copyComponentDir, COMPONENTS_DIR);
              return {
                newParams: {
                  dirPathOld,
                },
              };
            },
            (entryPath, params) => {
              const ext = path.extname(entryPath).toLowerCase();
              if (!['.json', '.js'].includes(ext)) return;
              const fileContent = fs.readFileSync(entryPath, 'utf-8');
              console.log(`处理文件: ${entryPath}`);

              let replaced = fileContent.replace(
                new RegExp(`(["'])((\.\.\/)+)([^"'\\\n]+)(["'])`, 'g'),
                (fullMatch, quote, fromEntryToRootOldPrefix) => {
                  const dependencyPath = path.resolve(params.dirPathOld, fullMatch.replaceAll('"', ''));
                  if (dependencyPath.includes(COMPONENTS_DIR)) {
                    // 如果引用的依赖只要是在当前子包已复制的组件，要跳过，不用处理
                    // 先获取dependencyPath中components底下一级目录的名称
                    const componentNameOfDependency = dependencyPath
                      .replace(COMPONENTS_DIR, '')
                      .match(/([^/]+)\//)?.[1];
                    // componentNameOfDependency只要是在当前子包已复制的组件
                    if (componentNameOfDependency && allCopyComponentNames.includes(componentNameOfDependency)) {
                      console.log(`Match found: 引用的依赖是当前子包已复制的组件内的文件，不用处理`, {
                        componentNameOfDependency,
                        fullMatch,
                      });
                      return fullMatch;
                    }
                  }
                  const newPath = `\"${path.relative(path.dirname(entryPath), dependencyPath).replace(/\\/g, '/')}\"`;
                  console.log('Match found:', {
                    entryPath,
                    fullMatch,
                    fromEntryToRootOldPrefix,
                    newPath,
                  });
                  return newPath;
                },
              );
              if (replaced !== fileContent) {
                fs.writeFileSync(entryPath, replaced, 'utf-8');
                console.log(`✅ 处理文件: ${entryPath}`);
                replaceCount++;
              }
            },
          );
        }
      });

      // 优化完成，输出统计信息
      const optimizationSummary = [
        '🎉 [Task] 小程序包优化完成！',
        '📊 [Task] 优化统计:',
        `  - 主包使用组件数：优化前${allComponentDirs.length}-> 优化后：${usedByMain.size}`,
        `  - 从主包移除组件数: ${allComponentDirs.length - usedByMain.size} (${deleteCount})`,
        `  - 分析JSON文件数: ${jsonCount}`,
        `  - 检查文件数: ${fileCount}`,
        `  - 执行路径替换（写入）次数: ${replaceCount}`,
      ];

      // 记录到日志数组
      optimizationSummary.forEach(msg => logs.push(msg));

      // 无论是否启用详细日志，都要输出最终的优化结果
      console.log = originalConsoleLog; // 恢复原始 log 方法
      optimizationSummary.forEach(msg => originalConsoleLog(msg));

      // 写入日志文件
      fs.writeFileSync(logFilePath, logs.join('\n'), { flag: 'w', encoding: 'utf-8' });
      originalConsoleLog('📝 [日志输出] 所有 log 已写入：', logFilePath);
    },
  };
}

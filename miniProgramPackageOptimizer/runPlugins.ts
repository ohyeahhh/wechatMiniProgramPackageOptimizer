import miniProgramPackageOptimizer from "./miniProgramPackageOptimizer";
const distDir = "path-to-your-project/dist/build/mp-weixin";
if (distDir.indexOf("path-to-your-project") > -1) {
  console.error("请替换为您的项目路径");
  throw new Error("请替换为您的项目路径");
}
const plugin = miniProgramPackageOptimizer({
  distDir,
}) as any;
plugin.writeBundle.call(null, {});

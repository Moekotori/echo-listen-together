import { readConfig } from './config.mjs';
import { checkPublicHealth, deploymentInfo } from './deployment-info.mjs';
const config = readConfig();
const healthy = await checkPublicHealth(config);
console.log(deploymentInfo(config, healthy ? 'passed' : 'failed'));
if (!healthy) process.exitCode = 1;

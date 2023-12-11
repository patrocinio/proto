#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PrototypeCertDebuggingChallengeStack } from './prototype-cert-debugging-challenge-stack';
import { getConfig } from "./utils/config";

const app = new cdk.App();

  //Load config, when ready start the app
  console.log("Loading Configurations...");
  const config = getConfig();
  console.log(config);
  console.log("DONE");

  if (!config) throw Error("Config not defined");

  cdk.Tags.of(app).add("App", config.appName);
  cdk.Tags.of(app).add("Env", config.envName);


const debuggingChallengeStack = new PrototypeCertDebuggingChallengeStack(app, `${config.appName}-${config.envName}-stack`, {config});

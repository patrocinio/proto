import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { AppConfig } from "./utils/config";
import * as path from "path";
import * as apigw from 'aws-cdk-lib/aws-apigateway';

interface DebuggingChallengeConfigurationsStackProps extends StackProps {
  readonly config: AppConfig;
}

export class PrototypeCertDebuggingChallengeStack extends Stack {
  constructor(scope: Construct, id: string, props: DebuggingChallengeConfigurationsStackProps) {
    super(scope, id, props);

    const fileUploadBucket = new s3.Bucket(this,'fileUploadBucket',{bucketName : `${props.config.appName}-${props.config.envName}-file-upload-bucket`});

    const reportBucket = new s3.Bucket(this,'reportBucket',{bucketName : `${props.config.appName}-${props.config.envName}-file-upload-bucket`});

    const pollyTaskCompletionBucket = new s3.Bucket(this,'pollyTaskCompletionBucket',{bucketName : `${props.config.appName}-${props.config.envName}-polly-completion-bucket`});

    const pollyTaskCompletionSns = new sns.Topic(this, 'pollyTaskCompletionSns',{topicName : `${props.config.appName}-${props.config.envName}-polly-task-completion`});

    const fileMetadataTable = new dynamodb.Table(this, `${props.config.appName}-${props.config.envName}-file-metadata`, {
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      tableName : `${props.config.appName}-${props.config.envName}-file-metadata`
    });
    fileMetadataTable.addGlobalSecondaryIndex({
      indexName :'report-index',
      partitionKey : {
        name: 'current_date',
        type: dynamodb.AttributeType.STRING
      },
      sortKey:{
        name: 'creation_time',
        type: dynamodb.AttributeType.STRING
      }
    });

    //file processor lambda
    const processorLambdaRole = new iam.Role(this, 'LambdaProcessorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    const fileProcessorLambda = new lambda.Function(this, 'fileProcessorLambda', {
      functionName : `${props.config.appName}-${props.config.envName}-file-processor`,
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'fileProcessor.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/lambda/file-processor-lambda')),
      timeout: Duration.minutes(5),
      memorySize: 512,
      environment: {
        POLLY_TASK_COMPLETION_SNS_ARN: pollyTaskCompletionSns.topicArn,
        AUDIO_FILE_BUCKET:pollyTaskCompletionBucket.bucketName,
        DDB_METADATA_TABLE: fileMetadataTable.tableName
      },
      role: processorLambdaRole
    });

    //file processor lambda permissions
    fileUploadBucket.grantReadWrite(fileProcessorLambda)
    processorLambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"));
    const lambdaPollyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['polly:StartSpeechSynthesisTask','polly:SynthesizeSpeech','sns:Publish'],
      resources: ['*']
    })
    processorLambdaRole.addToPolicy(lambdaPollyStatement);
    fileMetadataTable.grantReadWriteData(fileProcessorLambda);
    fileProcessorLambda.addEventSource(new eventsources.SnsEventSource(pollyTaskCompletionSns))

    //report lambda
    const reportLambdaRole = new iam.Role(this, 'LambdaReportRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    const reportLambda = new lambda.Function(this, 'reportLambda', {
      functionName: `${props.config.appName}-${props.config.envName}-report-generator`,
      runtime: lambda.Runtime.PYTHON_3_11,    
      code: lambda.Code.fromAsset(path.join(__dirname, '/lambda/report-generator-lambda')),  
      handler: 'reportGenerator.handler',
      layers: [lambda.LayerVersion.fromLayerVersionArn(this,'awsPandasLayer','arn:aws:lambda:us-east-1:336392948345:layer:AWSSDKPandas-Python311:2')],
      environment: {
        REPORT_BUCKET: fileUploadBucket.bucketName,
        DDB_METADATA_TABLE: fileMetadataTable.tableName,
      },
      role:  reportLambdaRole           
    });
    
    //report lambda permissions
    reportLambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"));
    reportBucket.grantWrite(reportLambda)
    fileUploadBucket.grantWrite(reportLambda)
    fileMetadataTable.grantReadData(reportLambda)

    //report lambda API
    const api = new apigw.LambdaRestApi(this, 'reportApi', {
      handler: reportLambda,
      proxy: false,
      restApiName: `${props.config.appName}-${props.config.envName}-report-api`
    });
    const reportResource = api.root.addResource('runReport').addMethod('POST')
    
  }
}

import boto3
import os
from datetime import datetime
import json

polly_client = boto3.client('polly')
s3_client = boto3.client('s3')
dynamodb_client = boto3.client('dynamodb')
FILE_PROCESS_START = 'FILE_PROCESS_START'
FILE_PROCESS_END = 'FILE_PROCESS_END'


def handler(event,context):
    records = event['Records']
    if records is None:
        print('null record')
        return
    
    for record in records:
        if ('eventSource' in record) and ('eventName' in record):
            if record['eventSource'] == 'aws:s3' and record['eventName'] == 'ObjectCreated:Put':
                process_new_file(record)
        elif ('EventSource' in record):
            if record['EventSource'] == 'aws:sns':
                update_processed_file(record)

    return {
       'statusCode': 200,
    }


def process_new_file(record):
    source_bucket_name = record['s3']['bucket']['name']
    source_bucket_key = record['s3']['object']['key']
    print('S3 PUT event, processing new file: ' + source_bucket_key)
    s3_file_string = getS3FileAsString(source_bucket_name,source_bucket_key)
    polly_task_details = start_polly_task(s3_file_string,source_bucket_key)
    write_progress_to_dynamo(FILE_PROCESS_START,polly_task_details)
    return

def update_processed_file(record):
    print('SNS event, update file status')
    sns_message_string =record['Sns']['Message']
    sns_message_obj = json.loads(sns_message_string)

    task_details = {
        'task_id' : sns_message_obj['taskId'],
        'end_time' : datetime.now().isoformat(),
        'task_message': sns_message_string
    }
    write_progress_to_dynamo(FILE_PROCESS_END,task_details)


def getS3FileAsString(source_bucket_name,source_bucket_key):
    s3_response = s3_client.get_object(Bucket=source_bucket_name,Key=source_bucket_key)
    s3_object_body = s3_response.get('Body')
    file_str = s3_object_body.read().decode()
    return file_str

def start_polly_task(s3_file_string,source_bucket_key):
    print('starting polly task for file : ' + source_bucket_key)
    output_bucket = os.environ.get('AUDIO_FILE_BUCKET')
    sns_topic_arn = os.environ.get('POLLY_TASK_COMPLETION_SNS_ARN')
    response = polly_client.start_speech_synthesis_task(VoiceId='Joanna',
                OutputS3BucketName=output_bucket,
                OutputS3KeyPrefix=source_bucket_key,
                OutputFormat='mp3', 
                Text=s3_file_string,
                Engine='neural',
                SnsTopicArn=sns_topic_arn)
    task_details = {
        'task_id': response['SynthesisTask']['TaskId'],
        'task_status' : response['SynthesisTask']['TaskStatus'],
        'creation_time' : response['SynthesisTask']['CreationTime'].isoformat(),
        'file_name' : source_bucket_key,
        'current_date' : response['SynthesisTask']['CreationTime'].strftime('%Y-%m-%d')
    }
    return task_details

def write_progress_to_dynamo(file_status,task_details):
    ddb_table_name= os.environ.get('DDB_METADATA_TABLE')
    if file_status == FILE_PROCESS_START:
        dynamodb_client.put_item(
        TableName=ddb_table_name,
        Item={
            'id': {'S': task_details['task_id']},
            'file_name': {'S': task_details['file_name']},
            'task_status': {'S': task_details['task_status']},
            'creation_time': {'S': task_details['creation_time']},
            'end_time': {'S': ''},
            'task_completion_message':{'S': ''},
            'current_date':{'S':task_details['current_date']},
        }
        )
        print('New file process recorded in dynamo: ' + task_details['task_id'] )

    if file_status == FILE_PROCESS_END:
        dynamodb_client.update_item(
        TableName=ddb_table_name,
        Key={'id':{'S':task_details['task_id']}},
        UpdateExpression='SET end_time=:t, task_status=:s, task_completion_message=:m',
        ExpressionAttributeValues={
            ':t': {'S':task_details['end_time']},
            ':m': {'S':task_details['task_message']}
        }
        )
        print('Processed file updated in dynamo: ' + task_details['task_id'] )


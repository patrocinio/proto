import boto3
import pandas as pd
from datetime import datetime
from io import StringIO
import os

s3_resource = boto3.resource('s3')
dynamodb_client = boto3.client('dynamodb')

def handler(event,context):
    
    # Calculate the date for today's report
    curr_date = datetime.now().strftime("%Y-%m-%d")

    response = dynamodb_client.query(
    TableName=os.environ.get('DDB_METADATA_TABLE'),
    IndexName='report-index',
    KeyConditionExpression="#date = :d",
    ExpressionAttributeNames={"#date": "current_date"},
    ExpressionAttributeValues={
        ":d": {"S": curr_date}
    }
    )
    data = response['Items']

    df = pd.DataFrame(data)

    #Dynamo entries include the data type, This line of code
    #replaces the dictionary with just the dictionary's key, i.e
    # i.e task_status : {'S':'COMPLETED'} -> task_status : 'COMPLETED'
    df = df.apply(lambda col: col.apply(lambda x : list(x.values())[0] if isinstance(x,dict) else x))

    status_counts = df['task_status'].value_counts()
    total_df = pd.DataFrame({'TotalFailed':[f'{status_counts.get("FAILED",0)}'], 'TotalCompleted':[f'{status_counts.get("COMPLETED",0)}']})
    combined_df = pd.concat([df,total_df],ignore_index=True)

    csv_buffer = StringIO()
    combined_df.to_csv(csv_buffer)
    s3_resource.Object(os.environ.get('REPORT_BUCKET'), f'{datetime.now().isoformat()}.csv').put(Body=csv_buffer.getvalue())

    response = {
        "statusCode": 200,
        "headers": {
        "Content-Type": "application/json"
        },
        "body": f'Report for {curr_date} generated successfully'
    }

    return 
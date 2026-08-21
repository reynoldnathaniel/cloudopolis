// Official AWS Architecture Icons, via the aws-svg-icons package
// (mirrors AWS's downloadable asset package). Vite turns these into URLs.

import ec2 from 'aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Compute/64/Arch_Amazon-EC2_64.svg'
import asg from 'aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Compute/64/Arch_Amazon-EC2-Auto-Scaling_64.svg'
import lambda from 'aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Compute/64/Arch_AWS-Lambda_64.svg'
import fargate from 'aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Containers/64/Arch_AWS-Fargate_64.svg'
import s3 from 'aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Storage/64/Arch_Amazon-Simple-Storage-Service_64.svg'
import cloudfront from 'aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Networking-Content-Delivery/64/Arch_Amazon-CloudFront_64.svg'
import alb from 'aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Networking-Content-Delivery/64/Arch_Elastic-Load-Balancing_64.svg'
import route53 from 'aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Networking-Content-Delivery/64/Arch_Amazon-Route-53_64.svg'
import waf from 'aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Security-Identity-Compliance/64/Arch_AWS-WAF_64.svg'
import apigw from 'aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_App-Integration/Arch_64/Arch_Amazon-API-Gateway_64.svg'
import rds from 'aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Database/64/Arch_Amazon-RDS_64.svg'
// No pack ships a dedicated read-replica icon; the RDS *instance* resource icon
// is exactly what a replica is, and reads differently from the service icon
// above so primary and replica are told apart at a glance.
import rdsReplica from 'aws-svg-icons/lib/Resource-Icons_07302021/Res_Database/Res_48_Dark/Res_Amazon-Aurora_Amazon-RDS-Instance_48_Dark.svg'
import dynamodb from 'aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Database/64/Arch_Amazon-DynamoDB_64.svg'
import elasticache from 'aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Database/64/Arch_Amazon-ElastiCache_64.svg'
import users from 'aws-svg-icons/lib/Resource-Icons_07302021/Res_General-Icons/Res_48_Dark/Res_Users_48_Dark.svg'
import sqs from 'aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_App-Integration/Arch_64/Arch_Amazon-Simple-Queue-Service_64.svg'
import sns from 'aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_App-Integration/Arch_64/Arch_Amazon-Simple-Notification-Service_64.svg'
import kinesis from 'aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Analytics/Arch_64/Arch_Amazon-Kinesis-Data-Streams_64.svg'
import sagemaker from 'aws-svg-icons/lib/Architecture-Service-Icons_07302021/Arch_Machine-Learning/64/Arch_Amazon-SageMaker_64.svg'
// Bedrock postdates the 2021 asset pack — its official icon comes from aws-icons.
import bedrock from 'aws-icons/icons/architecture-service/AmazonBedrock.svg'
// Likewise OpenSearch, which was still called Elasticsearch Service in 2021.
import opensearch from 'aws-icons/icons/architecture-service/AmazonOpenSearchService.svg'

export const ICONS: Record<string, string> = {
  ec2,
  asg,
  fargate,
  lambda,
  'lambda-pc': lambda,
  s3,
  cloudfront,
  alb,
  route53,
  waf,
  apigw,
  rds,
  'rds-replica': rdsReplica,
  dynamodb,
  elasticache,
  users,
  sqs,
  sns,
  kinesis,
  sagemaker,
  bedrock,
  opensearch,
}

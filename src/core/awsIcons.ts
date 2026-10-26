import type { GNode } from './types';

/**
 * Maps a CloudFormation / SAM / Terraform resource to an official AWS Architecture
 * service icon (file stem in `aws-icons/icons/architecture-service`). Pure — the URL
 * lookup lives in the UI layer.
 */

/** Normalised service token → icon. Tokens come from CFN `AWS::<Service>::…` or TF `aws_<service>_…`. */
const SERVICE: Record<string, string> = {
  lambda: 'AWSLambda',
  serverless: 'AWSLambda',
  dynamodb: 'AmazonDynamoDB',
  sqs: 'AmazonSimpleQueueService',
  sns: 'AmazonSimpleNotificationService',
  iam: 'AWSIdentityandAccessManagement',
  apigateway: 'AmazonAPIGateway',
  apigatewayv2: 'AmazonAPIGateway',
  api_gateway: 'AmazonAPIGateway',
  cloudwatch: 'AmazonCloudWatch',
  logs: 'AmazonCloudWatch',
  s3: 'AmazonSimpleStorageService',
  ec2: 'AmazonEC2',
  vpc: 'AmazonVirtualPrivateCloud',
  ecs: 'AmazonElasticContainerService',
  eks: 'AmazonElasticKubernetesService',
  ecr: 'AmazonElasticContainerRegistry',
  rds: 'AmazonRDS',
  db: 'AmazonRDS',
  aurora: 'AmazonAurora',
  elasticache: 'AmazonElastiCache',
  elasticloadbalancing: 'ElasticLoadBalancing',
  elasticloadbalancingv2: 'ElasticLoadBalancing',
  lb: 'ElasticLoadBalancing',
  alb: 'ElasticLoadBalancing',
  elb: 'ElasticLoadBalancing',
  autoscaling: 'AmazonEC2AutoScaling',
  applicationautoscaling: 'AWSApplicationAutoScaling',
  appautoscaling: 'AWSApplicationAutoScaling',
  route53: 'AmazonRoute53',
  cloudfront: 'AmazonCloudFront',
  kms: 'AWSKeyManagementService',
  secretsmanager: 'AWSSecretsManager',
  cognito: 'AmazonCognito',
  stepfunctions: 'AWSStepFunctions',
  sfn: 'AWSStepFunctions',
  events: 'AmazonEventBridge',
  scheduler: 'AmazonEventBridge',
  pipes: 'AmazonEventBridge',
  kinesis: 'AmazonKinesis',
  kinesisfirehose: 'AmazonDataFirehose',
  firehose: 'AmazonDataFirehose',
  certificatemanager: 'AWSCertificateManager',
  acm: 'AWSCertificateManager',
  waf: 'AWSWAF',
  wafv2: 'AWSWAF',
  efs: 'AmazonEFS',
  ssm: 'AWSSystemsManager',
  cloudformation: 'AWSCloudFormation',
  backup: 'AWSBackup',
  glue: 'AWSGlue',
  athena: 'AmazonAthena',
  redshift: 'AmazonRedshift',
  opensearchservice: 'AmazonOpenSearchService',
  opensearch: 'AmazonOpenSearchService',
  elasticsearch: 'AmazonOpenSearchService',
  msk: 'AmazonManagedStreamingforApacheKafka',
  appsync: 'AWSAppSync',
  amplify: 'AWSAmplify',
  codebuild: 'AWSCodeBuild',
  codepipeline: 'AWSCodePipeline',
  codecommit: 'AWSCodeCommit',
  codedeploy: 'AWSCodeDeploy',
  batch: 'AWSBatch',
  ses: 'AmazonSimpleEmailService',
  sesv2: 'AmazonSimpleEmailService',
  xray: 'AWSXRay',
  config: 'AWSConfig',
  cloudtrail: 'AWSCloudTrail',
  guardduty: 'AmazonGuardDuty',
  sagemaker: 'AmazonSageMaker',
  bedrock: 'AmazonBedrock',
  neptune: 'AmazonNeptune',
  docdb: 'AmazonDocumentDB',
  memorydb: 'AmazonMemoryDB',
  mq: 'AmazonMQ',
  amazonmq: 'AmazonMQ',
  servicediscovery: 'AWSCloudMap',
  service_discovery: 'AWSCloudMap',
  apprunner: 'AWSAppRunner',
  elasticbeanstalk: 'AWSElasticBeanstalk',
  elastic_beanstalk: 'AWSElasticBeanstalk',
  transfer: 'AWSTransferFamily',
  networkfirewall: 'AWSNetworkFirewall',
  shield: 'AWSShield',
  lightsail: 'AmazonLightsail',
  fsx: 'AmazonFSx',
  timestream: 'AmazonTimestream',
  keyspaces: 'AmazonKeyspaces',
  cassandra: 'AmazonKeyspaces',
  emr: 'AmazonEMR',
  securityhub: 'AWSSecurityHub',
  inspector: 'AmazonInspector',
  organizations: 'AWSOrganizations',
  ram: 'AWSResourceAccessManager',
  transitgateway: 'AWSTransitGateway',
  ec2transitgateway: 'AWSTransitGateway',
  globalaccelerator: 'AWSGlobalAccelerator',
  directconnect: 'AWSDirectConnect',
  dx: 'AWSDirectConnect',
  grafana: 'AmazonManagedGrafana',
  prometheus: 'AmazonManagedServiceforPrometheus',
  aps: 'AmazonManagedServiceforPrometheus',
  location: 'AmazonLocationService',
  iot: 'AWSIoTCore',
  connect: 'AmazonConnect',
  workspaces: 'AmazonWorkSpaces',
  quicksight: 'AmazonQuickSuite',
  lakeformation: 'AWSLakeFormation',
  datasync: 'AWSDataSync',
  dms: 'AWSDatabaseMigrationService',
  storagegateway: 'AWSStorageGateway',
};

/** EC2-namespace resources that are really networking — drawn with the VPC icon. */
const EC2_NETWORK =
  /^(vpc|subnet|security_group|internet_gateway|nat_gateway|route|route_table|eip|network_acl|network_interface|egress_only_internet_gateway|vpn_gateway|vpn_connection|customer_gateway|flow_log|default_vpc|default_subnet|default_security_group|default_route_table|default_network_acl|main_route_table_association|prefix_list)(_|$)/;
const EC2_TRANSIT = /^transit_gateway(_|$)/;
const EC2_VOLUME = /^(volume|ebs_volume|ebs)(_|$)/;

/** `VPCGatewayAttachment` → `vpc_gateway_attachment`. */
const snake = (s: string) =>
  s
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();

function ec2Detail(rest: string): string {
  if (EC2_TRANSIT.test(rest)) return 'AWSTransitGateway';
  if (EC2_NETWORK.test(rest)) return 'AmazonVirtualPrivateCloud';
  if (EC2_VOLUME.test(rest)) return 'AmazonElasticBlockStore';
  return 'AmazonEC2';
}

/** `AWS::EC2::SecurityGroup`, `AWS::Serverless::Function`, `aws_lb_listener`, `data.aws_ami.x`. */
export function awsIconForType(type: string): string | undefined {
  if (type.startsWith('AWS::')) {
    const [, service = '', resource = ''] = type.split('::');
    const svc = service.toLowerCase();
    if (svc === 'ec2') return ec2Detail(snake(resource));
    if (svc === 'serverless') {
      const r = resource.toLowerCase();
      if (r === 'api' || r === 'httpapi') return 'AmazonAPIGateway';
      if (r === 'simpletable') return 'AmazonDynamoDB';
      if (r === 'statemachine') return 'AWSStepFunctions';
      if (r === 'layerversion') return 'AWSLambda';
      return 'AWSLambda';
    }
    return SERVICE[svc];
  }
  const tf = type.replace(/^data\./, '').split('.')[0];
  if (!tf.startsWith('aws_')) return undefined;
  const rest = tf.slice(4);
  // Networking resources live at the top level in the AWS provider (aws_subnet, aws_security_group…).
  if (EC2_TRANSIT.test(rest)) return 'AWSTransitGateway';
  if (EC2_NETWORK.test(rest)) return 'AmazonVirtualPrivateCloud';
  if (/^(instance|launch_template|launch_configuration|ami|key_pair|placement_group|spot_\w+)(_|$)/.test(rest)) return 'AmazonEC2';
  if (EC2_VOLUME.test(rest)) return 'AmazonElasticBlockStore';
  if (rest.startsWith('cloudwatch_event')) return 'AmazonEventBridge';
  if (rest.startsWith('kinesis_firehose')) return 'AmazonDataFirehose';
  // Longest matching prefix wins: `api_gateway_…` before `api…`, `lb_…` before `l…`.
  const tokens = rest.split('_');
  for (let n = Math.min(3, tokens.length); n >= 1; n--) {
    const key = tokens.slice(0, n).join('_');
    if (SERVICE[key]) return SERVICE[key];
    const joined = tokens.slice(0, n).join('');
    if (SERVICE[joined]) return SERVICE[joined];
  }
  return undefined;
}

/** Module sources like `terraform-aws-modules/vpc/aws` or `…/s3-bucket/aws`. */
function awsIconForModule(source: string): string | undefined {
  const m = /terraform-aws-modules\/([\w-]+)\/aws/.exec(source) ?? /aws[-_]([\w]+)/.exec(source);
  if (!m) return undefined;
  const name = m[1].toLowerCase();
  const first = name.split('-')[0];
  if (name === 'security-group') return 'AmazonVirtualPrivateCloud';
  if (name === 'apigateway-v2') return 'AmazonAPIGateway';
  return SERVICE[name.replace(/-/g, '')] ?? SERVICE[first];
}

export function awsIconFor(node: GNode): string | undefined {
  if (node.kind === 'provider') return node.tag === 'aws' ? 'AWSCloudlogo' : undefined;
  if (node.kind === 'module') return awsIconForModule(node.sub ?? '');
  if (node.kind !== 'resource' && node.kind !== 'data') return undefined;
  return node.type ? awsIconForType(node.type) : undefined;
}

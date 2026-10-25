import type { Category } from './types';

/**
 * Keyword → family. Matched against a lower-cased service name, e.g. "ec2::securitygroup"
 * for CloudFormation or "aws_security_group" for Terraform. First match wins, so the
 * more specific network/security words sit above the broad compute ones.
 */
const RULES: [RegExp, Category][] = [
  [/(securitygroup|security_group|iam|kms|secretsmanager|secret|cognito|acm|certificate|waf|policy|role|key_vault|keyvault)/, 'security'],
  [/(vpc|subnet|route|gateway|nat|eip|elasticloadbalancing|elb|lb_|_lb|loadbalancer|cloudfront|apigateway|api_gateway|route53|dns|network|firewall|endpoint|listener|target_group|targetgroup)/, 'network'],
  [/(sqs|sns|events|eventbridge|kinesis|stepfunctions|sfn|mq|pubsub|servicebus|eventhub|msk|kafka)/, 'messaging'],
  [/(logs|cloudwatch|monitor|alarm|dashboard|xray|log_group|loggroup|metric)/, 'observe'],
  [/(s3|dynamodb|rds|aurora|elasticache|efs|storage|bucket|database|db_|_db|sql|redis|backup|glue|athena|redshift|opensearch|elasticsearch|ecr)/, 'data'],
  [/(ec2|instance|lambda|function|ecs|eks|autoscaling|batch|fargate|container|compute|launch|kubernetes|cluster|vm|apprunner|beanstalk)/, 'compute'],
];

export function categorize(service: string): Category {
  const s = service.toLowerCase();
  for (const [re, cat] of RULES) if (re.test(s)) return cat;
  return 'other';
}

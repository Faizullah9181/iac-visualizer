const ACRONYMS = new Set([
  'lb', 'alb', 'nlb', 'elb', 'sg', 'iam', 's3', 'ec2', 'vpc', 'ami', 'dns', 'sqs', 'sns', 'kms', 'ecs', 'eks', 'rds', 'api',
  'acm', 'waf', 'nat', 'eip', 'id', 'arn', 'ssm', 'efs', 'ecr', 'db', 'az', 'cdn', 'ip', 'http', 'https', 'tls', 'ssl', 'sql',
  'vm', 'gke', 'aks', 'iot', 'msk', 'emr', 'ebs', 'sso',
]);

const word = (w: string) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1));

/** `aws_lb_target_group` → `LB Target Group` (provider prefix dropped). */
export function humanizeTfType(type: string): string {
  const parts = type.split('_');
  return (parts.length > 1 ? parts.slice(1) : parts).map(word).join(' ');
}

/** `EventSourceMapping` → `Event Source Mapping`. */
export function humanizeCfnType(name: string): string {
  return name
    .split('::')
    .map((p) => p.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2'))
    .join(' ');
}

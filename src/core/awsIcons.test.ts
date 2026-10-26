import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from '../parsers';
import { SAMPLES } from '../samples';
import { awsIconFor, awsIconForType } from './awsIcons';

const ICON_DIR = resolve(__dirname, '../../node_modules/aws-icons/icons');
const exists = (stem: string) =>
  existsSync(`${ICON_DIR}/architecture-service/${stem}.svg`) || existsSync(`${ICON_DIR}/architecture-group/${stem}.svg`);

describe('awsIconForType', () => {
  it.each([
    ['AWS::Lambda::Function', 'AWSLambda'],
    ['AWS::Serverless::Function', 'AWSLambda'],
    ['AWS::Serverless::HttpApi', 'AmazonAPIGateway'],
    ['AWS::EC2::SecurityGroup', 'AmazonVirtualPrivateCloud'],
    ['AWS::EC2::VPCGatewayAttachment', 'AmazonVirtualPrivateCloud'],
    ['AWS::EC2::Instance', 'AmazonEC2'],
    ['AWS::EC2::Volume', 'AmazonElasticBlockStore'],
    ['AWS::EC2::TransitGateway', 'AWSTransitGateway'],
    ['AWS::ElasticLoadBalancingV2::Listener', 'ElasticLoadBalancing'],
    ['AWS::ApiGatewayV2::Api', 'AmazonAPIGateway'],
    ['AWS::DynamoDB::Table', 'AmazonDynamoDB'],
    ['AWS::Logs::LogGroup', 'AmazonCloudWatch'],
    ['aws_lb_target_group.web', 'ElasticLoadBalancing'],
    ['aws_security_group.web', 'AmazonVirtualPrivateCloud'],
    ['aws_route53_zone.main', 'AmazonRoute53'],
    ['aws_route_table.private', 'AmazonVirtualPrivateCloud'],
    ['aws_api_gateway_rest_api.api', 'AmazonAPIGateway'],
    ['aws_cloudwatch_event_rule.r', 'AmazonEventBridge'],
    ['aws_cloudwatch_log_group.g', 'AmazonCloudWatch'],
    ['aws_ec2_transit_gateway.tgw', 'AWSTransitGateway'],
    ['aws_db_instance.db', 'AmazonRDS'],
    ['aws_launch_template.web', 'AmazonEC2'],
    ['data.aws_ami.ubuntu', 'AmazonEC2'],
    ['aws_kinesis_firehose_delivery_stream.f', 'AmazonDataFirehose'],
  ])('%s → %s', (type, icon) => {
    expect(awsIconForType(type)).toBe(icon);
  });

  it('leaves non-AWS and unknown types without an icon', () => {
    expect(awsIconForType('google_compute_instance.vm')).toBeUndefined();
    expect(awsIconForType('data.aws_availability_zones.available')).toBeUndefined();
  });
});

describe('icon files', () => {
  it('every mapped icon exists in the aws-icons package', () => {
    const src = readFileSync(resolve(__dirname, 'awsIcons.ts'), 'utf8');
    const stems = [...new Set([...src.matchAll(/'((?:AWS|Amazon|Elastic)[A-Za-z0-9]+)'/g)].map((m) => m[1]))];
    expect(stems.length).toBeGreaterThan(60);
    expect(stems.filter((s) => !exists(s))).toEqual([]);
  });

  it('every AWS resource in the samples gets an icon', () => {
    for (const s of SAMPLES.filter((x) => x.format === 'cloudformation' || x.format === 'terraform')) {
      const g = parse(s.text, s.format).graph!;
      const missing = g.nodes.filter((n) => (n.kind === 'resource' || n.kind === 'module') && !awsIconFor(n)).map((n) => n.id);
      expect(missing, s.id).toEqual([]);
    }
  });
});

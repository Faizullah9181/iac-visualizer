import type { Format } from '../core/types';
import otel from './otel.yaml?raw';
import cloudformation from './cloudformation.yaml?raw';
import terraform from './terraform.tf?raw';
import ansible from './ansible.yaml?raw';

export interface Sample {
  id: string;
  format: Format;
  title: string;
  blurb: string;
  text: string;
}

export const SAMPLES: Sample[] = [
  { id: 'otel-gateway', format: 'otel', title: 'Collector gateway', blurb: 'Tail sampling, span metrics connector, three signals', text: otel },
  { id: 'cfn-serverless', format: 'cloudformation', title: 'Serverless API', blurb: 'API Gateway → Lambda → DynamoDB + SQS worker', text: cloudformation },
  { id: 'tf-web', format: 'terraform', title: 'Autoscaled web tier', blurb: 'VPC module, ALB, launch template, ASG', text: terraform },
  { id: 'ansible-deploy', format: 'ansible', title: 'App deploy playbook', blurb: 'Roles, blocks with rescue, handlers, register', text: ansible },
];

export const sampleFor = (f: Format) => SAMPLES.find((s) => s.format === f)!;

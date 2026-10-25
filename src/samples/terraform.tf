terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

variable "region" {
  type    = string
  default = "eu-west-2"
}

variable "env" {
  type    = string
  default = "staging"
}

variable "instance_type" {
  type    = string
  default = "t3.small"
}

variable "legacy_ami" {
  type = string
}

locals {
  name = "web-${var.env}"
  tags = {
    Environment = var.env
    Owner       = "platform"
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
}

module "vpc" {
  source = "terraform-aws-modules/vpc/aws"
  name   = local.name
  cidr   = "10.0.0.0/16"
  azs    = slice(data.aws_availability_zones.available.names, 0, 2)
  tags   = local.tags
}

resource "aws_security_group" "web" {
  name   = "${local.name}-sg"
  vpc_id = module.vpc.vpc_id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_launch_template" "web" {
  name_prefix            = local.name
  image_id               = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  vpc_security_group_ids = [aws_security_group.web.id]
  user_data = base64encode(<<-EOT
    #!/bin/bash
    echo "hello from ${local.name}" > /var/www/index.html
  EOT
  )
}

resource "aws_lb" "web" {
  name            = local.name
  subnets         = module.vpc.public_subnets
  security_groups = [aws_security_group.web.id]
}

resource "aws_lb_target_group" "web" {
  port     = 443
  protocol = "HTTPS"
  vpc_id   = module.vpc.vpc_id
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.web.arn
  port              = 443
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_autoscaling_group" "web" {
  min_size            = 2
  max_size            = 6
  vpc_zone_identifier = module.vpc.private_subnets
  target_group_arns   = [aws_lb_target_group.web.arn]
  launch_template {
    id      = aws_launch_template.web.id
    version = "$Latest"
  }
  depends_on = [aws_lb_listener.https]
}

resource "aws_s3_bucket" "logs" {
  bucket = "${local.name}-alb-logs"
  tags   = local.tags
}

output "lb_dns" {
  value = aws_lb.web.dns_name
}

output "asg_name" {
  value = aws_autoscaling_group.web.name
}

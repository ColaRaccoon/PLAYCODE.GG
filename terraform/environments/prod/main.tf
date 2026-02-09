################################################################################
# PlayCode.gg — Production 인프라
################################################################################

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

locals {
  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  azs = ["${var.aws_region}a", "${var.aws_region}c"]
}

################################################################################
# VPC
################################################################################

module "vpc" {
  source = "../../modules/vpc"

  name           = "${var.project_name}-${var.environment}"
  vpc_cidr       = var.vpc_cidr
  azs            = local.azs
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24"]
  cluster_name   = "${var.project_name}-${var.environment}"
  tags           = local.common_tags
}

################################################################################
# ECR
################################################################################

module "ecr" {
  source = "../../modules/ecr"

  repository_name = "playcode-app"
  tags            = local.common_tags
}

################################################################################
# EKS
################################################################################

module "eks" {
  source = "../../modules/eks"

  cluster_name    = "${var.project_name}-${var.environment}"
  cluster_version = "1.30"

  vpc_id          = module.vpc.vpc_id
  private_subnets = module.vpc.private_subnets

  # EC2 단일 노드 환경에 맞게 설정
  node_instance_types = ["t3.medium"]
  node_min_size       = 1
  node_max_size       = 3
  node_desired_size   = 1

  environment            = var.environment
  ebs_csi_driver_role_arn = module.iam.ebs_csi_driver_role_arn
  tags                   = local.common_tags
}

################################################################################
# IAM (GitHub Actions OIDC + EKS IRSA)
################################################################################

module "iam" {
  source = "../../modules/iam"

  project_name          = var.project_name
  github_repository     = var.github_repository
  ecr_repository_arn    = module.ecr.repository_arn
  eks_oidc_provider_arn = module.eks.oidc_provider_arn
  tags                  = local.common_tags
}

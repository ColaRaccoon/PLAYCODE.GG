################################################################################
# EKS 모듈 — PlayCode.gg Kubernetes 클러스터
################################################################################

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = var.cluster_name
  cluster_version = var.cluster_version

  vpc_id     = var.vpc_id
  subnet_ids = var.private_subnets

  # 클러스터 엔드포인트 접근 설정
  cluster_endpoint_public_access  = true
  cluster_endpoint_private_access = true

  # 관리형 노드 그룹
  eks_managed_node_groups = {
    playcode = {
      name = "playcode-nodes"

      instance_types = var.node_instance_types
      capacity_type  = "ON_DEMAND"

      min_size     = var.node_min_size
      max_size     = var.node_max_size
      desired_size = var.node_desired_size

      # 디스크 크기
      disk_size = 30

      labels = {
        Environment = var.environment
        Application = "playcode"
      }

      tags = var.tags
    }
  }

  # 클러스터 애드온
  cluster_addons = {
    coredns = {
      most_recent = true
    }
    kube-proxy = {
      most_recent = true
    }
    vpc-cni = {
      most_recent = true
    }
    aws-ebs-csi-driver = {
      most_recent              = true
      service_account_role_arn = var.ebs_csi_driver_role_arn
    }
  }

  # OIDC Provider (IRSA용 — IAM Role for Service Account)
  enable_irsa = true

  tags = var.tags
}

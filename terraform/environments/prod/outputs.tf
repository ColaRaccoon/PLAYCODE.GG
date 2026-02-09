output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "eks_cluster_endpoint" {
  description = "EKS 클러스터 엔드포인트"
  value       = module.eks.cluster_endpoint
}

output "eks_cluster_name" {
  description = "EKS 클러스터 이름"
  value       = module.eks.cluster_name
}

output "ecr_repository_url" {
  description = "ECR 리포지토리 URL"
  value       = module.ecr.repository_url
}

output "github_actions_role_arn" {
  description = "GitHub Actions IAM 역할 ARN (CI/CD에 설정 필요)"
  value       = module.iam.github_actions_role_arn
}

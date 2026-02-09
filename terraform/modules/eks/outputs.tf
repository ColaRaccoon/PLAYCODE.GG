output "cluster_id" {
  description = "EKS 클러스터 ID"
  value       = module.eks.cluster_id
}

output "cluster_endpoint" {
  description = "EKS 클러스터 API 엔드포인트"
  value       = module.eks.cluster_endpoint
}

output "cluster_certificate_authority_data" {
  description = "클러스터 CA 인증서 데이터"
  value       = module.eks.cluster_certificate_authority_data
}

output "oidc_provider_arn" {
  description = "OIDC Provider ARN (IRSA용)"
  value       = module.eks.oidc_provider_arn
}

output "cluster_name" {
  description = "EKS 클러스터 이름"
  value       = module.eks.cluster_name
}

variable "project_name" {
  description = "프로젝트 이름 (IAM 리소스 접두사)"
  type        = string
}

variable "github_repository" {
  description = "GitHub 리포지토리 (owner/repo 형태)"
  type        = string
}

variable "github_oidc_thumbprint" {
  description = "GitHub OIDC Provider 인증서 thumbprint"
  type        = string
  default     = "6938fd4d98bab03faadb97b34396831e3780aea1"
}

variable "ecr_repository_arn" {
  description = "ECR 리포지토리 ARN"
  type        = string
}

variable "eks_oidc_provider_arn" {
  description = "EKS OIDC Provider ARN (IRSA용)"
  type        = string
  default     = ""
}

variable "tags" {
  description = "리소스에 적용할 공통 태그"
  type        = map(string)
  default     = {}
}

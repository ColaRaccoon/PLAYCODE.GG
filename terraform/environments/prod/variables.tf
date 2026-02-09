variable "aws_region" {
  description = "AWS 리전"
  type        = string
  default     = "ap-northeast-2"
}

variable "project_name" {
  description = "프로젝트 이름"
  type        = string
  default     = "playcode"
}

variable "environment" {
  description = "환경"
  type        = string
  default     = "prod"
}

variable "vpc_cidr" {
  description = "VPC CIDR 블록"
  type        = string
  default     = "10.0.0.0/16"
}

variable "github_repository" {
  description = "GitHub 리포지토리 (owner/repo)"
  type        = string
}

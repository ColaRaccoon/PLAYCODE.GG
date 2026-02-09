variable "name" {
  description = "VPC 이름"
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR 블록"
  type        = string
  default     = "10.0.0.0/16"
}

variable "azs" {
  description = "사용할 가용 영역 목록"
  type        = list(string)
}

variable "private_subnets" {
  description = "프라이빗 서브넷 CIDR 목록"
  type        = list(string)
}

variable "public_subnets" {
  description = "퍼블릭 서브넷 CIDR 목록"
  type        = list(string)
}

variable "cluster_name" {
  description = "EKS 클러스터 이름 (서브넷 태그에 사용)"
  type        = string
}

variable "tags" {
  description = "리소스에 적용할 공통 태그"
  type        = map(string)
  default     = {}
}

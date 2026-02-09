variable "cluster_name" {
  description = "EKS 클러스터 이름"
  type        = string
}

variable "cluster_version" {
  description = "Kubernetes 버전"
  type        = string
  default     = "1.30"
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "private_subnets" {
  description = "프라이빗 서브넷 ID 목록"
  type        = list(string)
}

variable "node_instance_types" {
  description = "워커 노드 인스턴스 타입"
  type        = list(string)
  default     = ["t3.medium"]
}

variable "node_min_size" {
  description = "노드 그룹 최소 크기"
  type        = number
  default     = 1
}

variable "node_max_size" {
  description = "노드 그룹 최대 크기"
  type        = number
  default     = 3
}

variable "node_desired_size" {
  description = "노드 그룹 희망 크기"
  type        = number
  default     = 1
}

variable "environment" {
  description = "환경 (dev/staging/prod)"
  type        = string
  default     = "prod"
}

variable "ebs_csi_driver_role_arn" {
  description = "EBS CSI 드라이버 IAM 역할 ARN"
  type        = string
  default     = ""
}

variable "tags" {
  description = "리소스에 적용할 공통 태그"
  type        = map(string)
  default     = {}
}

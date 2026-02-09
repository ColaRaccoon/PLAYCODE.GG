variable "repository_name" {
  description = "ECR 리포지토리 이름"
  type        = string
}

variable "tags" {
  description = "리소스에 적용할 공통 태그"
  type        = map(string)
  default     = {}
}

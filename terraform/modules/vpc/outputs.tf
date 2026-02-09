output "vpc_id" {
  description = "생성된 VPC ID"
  value       = module.vpc.vpc_id
}

output "private_subnets" {
  description = "프라이빗 서브넷 ID 목록"
  value       = module.vpc.private_subnets
}

output "public_subnets" {
  description = "퍼블릭 서브넷 ID 목록"
  value       = module.vpc.public_subnets
}

output "vpc_cidr_block" {
  description = "VPC CIDR 블록"
  value       = module.vpc.vpc_cidr_block
}

################################################################################
# Terraform 원격 상태 관리 — S3 + DynamoDB 상태 잠금
################################################################################

terraform {
  backend "s3" {
    bucket         = "playcode-terraform-state"
    key            = "prod/terraform.tfstate"
    region         = "ap-northeast-2"
    encrypt        = true
    dynamodb_table = "playcode-terraform-lock"
  }
}

import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class AddPortfolioLinkDto {
  @IsUrl({ require_protocol: true })
  @MaxLength(2000)
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}

#!/usr/bin/env node
import { Command } from 'commander';
import { CLIService } from './services/CLIService';

const program = new Command();
program.name('ai-analyzer').description('AI Agent usage analyzer with taste profiling').version('1.0.0');
new CLIService().register(program);
program.parse();

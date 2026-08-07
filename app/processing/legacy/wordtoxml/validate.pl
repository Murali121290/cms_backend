use Archive::Zip qw/ :ERROR_CODES :CONSTANTS /;
use Archive::Zip;
use Cwd 'abs_path';
use Cwd;
use Encode qw(decode encode);
use File::Basename;
use File::Copy::Recursive qw(dircopy);
use File::Copy::Recursive qw(pathrmdir);
use File::Copy;
use File::Find;
use File::HomeDir;
use File::Spec;
use File::stat;
use HTTP::Tiny;
use List::MoreUtils qw( minmax );
use POSIX qw(strftime);
use strict;
use String::Substitution qw( sub_modify );
use Sys::Hostname;
use Try::Tiny;
#use Uniq;
use utf8;
use warnings;         # still get other warnings
no warnings 'uninitialized';   # but silence uninitialized warnings
# use Win32; # Commented out for Linux/Docker compatibility
use XML::LibXML;

&DTDvalidate("$ARGV[0]");

sub DTDvalidate
{
	my $xml_file = shift;

	# -------- Log file (same name + .log) --------
	my ($name, $path, $suffix) = fileparse($xml_file, qr/\.[^.]*/);
	my $log_file = $path . $name . ".log";

	open(my $LOG, '>', $log_file) or die "Cannot open log file: $!";

	print $LOG "BITS DTD Validation Log\n";
	print $LOG "Input File : $xml_file\n";
	print $LOG "---------------------------------\n";

	# -------- XML Parser --------
	my $parser = XML::LibXML->new(
	    load_ext_dtd => 1,
	    validation   => 1
	);

	eval {
	    $parser->parse_file($xml_file);
	};

	if ($@) {
	    print $LOG "? VALIDATION FAILED\n\n";
	    print $LOG "$@\n";
	    print "Validation FAILED. See log: $log_file\n";
	} else {
	    print $LOG "? VALIDATION PASSED\n";
	    print "Validation PASSED.\n";
	}

	close $LOG;
}

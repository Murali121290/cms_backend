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
	my $script_dir = dirname(abs_path($0));
	my $parser = XML::LibXML->new(
	    load_ext_dtd    => 1,
	    validation      => 1,
	    expand_entities => 1,
	    ext_ent_handler => sub {
	        my ($system_id, $public_id) = @_;
	        my $resolved_id = $system_id;
	        
	        # Map `/app/wordtoxml` to the actual script directory
	        $resolved_id =~ s{^/app/wordtoxml}{$script_dir}g;
	        
	        # Extract filename (e.g., BITS-xinclude1.ent)
	        my ($filename) = fileparse($resolved_id);
	        
	        # List of subdirectories to search in order
	        my @search_dirs = (
	            "$script_dir/BITS-Book-1.0-DTD",
	            "$script_dir/BITS-Book-1.0-DTD/mathml",
	            "$script_dir/BITS-Book-1.0-DTD/iso8879",
	            "$script_dir/BITS-Book-1.0-DTD/iso9573-13",
	            "$script_dir/BITS-Book-1.0-DTD/xmlchars"
	        );
	        
	        my $found = 0;
	        foreach my $s_dir (@search_dirs) {
	            my $test_file = "$s_dir/$filename";
	            if (-f $test_file) {
	                $resolved_id = $test_file;
	                $found = 1;
	                last;
	            }
	        }
	        
	        # Otherwise, if not absolute, resolve relative to script_dir
	        if (!$found && $resolved_id !~ m{^/} && $resolved_id !~ m{^[A-Za-z]:}) {
	            $resolved_id = "$script_dir/$resolved_id";
	        }
	        
	        if (-f $resolved_id) {
	            open(my $fh, '<', $resolved_id) or die "Cannot open $resolved_id: $!";
	            local $/ = undef;
	            my $content = <$fh>;
	            close $fh;
	            return $content;
	        }
	        
	        return "";
	    }
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

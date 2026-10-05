use strict;
use warnings;

my($IN_File,$IN_Path,$IN_Files,@IN_Files,$OUT_File,$Tmp);

$IN_File=$ARGV[0];

#system ("dir *.xml /b >file.log");

#opendir(DIR,"$IN_Path") || die "Can't read current directory: $!\n";
#@IN_Files = sort grep /\.xml$/i, readdir DIR;
#closedir DIR;

#foreach $IN_File(@IN_Files)
#{
open (IN, "<:utf8", $IN_File) || die ("\nCould not open `$IN_File'\n");
{ local $/; $_=<IN>; $Tmp=$_; }
close(IN);

$Tmp =~ s/(.)/asciiize($1)/eg; 

sub asciiize {
    return $_[0] if (ord($_[0]) < 128);     
    return sprintf('&#x%04X;', ord($_[0])); 
}



open (XML, ">utf8",$IN_File) || die "Can't create XML file '$IN_File': $!\n";
{
        print XML $Tmp;
}
#}